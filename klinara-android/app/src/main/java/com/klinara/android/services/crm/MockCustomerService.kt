package com.klinara.android.services.crm

import com.klinara.android.services.formatting.SearchText
import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.PageInfo
import kotlinx.coroutines.delay
import java.time.Instant
import java.util.Base64
import kotlin.random.Random

/**
 * Müşteri servisinin mock'u.
 *
 * **Gerçekten sayfalıyor** — `MockBookingService`'in aksine. Orada tek sayfa döndürmek
 * doğruydu (sahte bir imleç, imleç MANTIĞINI değil KURGUSUNU test ederdi); burada
 * `loadMore` ekranın gerçek bir davranışı ve mock sayfalamazsa hiç sürülemez.
 * Sunucunun keyset kuralı taklit ediliyor: `(createdAt, id)` azalan.
 */
class MockCustomerService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
) : CustomerService {
    var failing: Boolean = false

    /**
     * Yazılabilir tablo — `MockCustomers.ALL` artık yalnız TOHUM.
     *
     * Mock yazma kazandığı an salt okunur bir listeyi okuyamaz: oluşturulan müşteri
     * listede görünmeli, arşivlenen kaybolmalı. Tohum sabit kalıyor ki her açılış aynı
     * yerden başlasın.
     */
    private val rows: MutableList<Customer> =
        MockCustomers.ALL.map { it.toCustomer() }.toMutableList()

    private val tagRows: MutableList<CustomerTag> = MockCustomers.Tags.ALL.toMutableList()

    private var idCounter: Int = MockCustomers.ALL.size

    /**
     * Başka mock'ların müşteri tablosunu OKUMASI için (A5: paket satışı müşteri varlığını,
     * raporlar müşteri adını soruyor). Kopya döner — dışarıdan yazılamasın.
     */
    internal fun snapshot(): List<Customer> = rows.toList()

    override suspend fun list(query: CustomerListQuery): Page<Customer> {
        settle()

        val limit = (query.limit ?: DEFAULT_LIMIT).coerceIn(1, MAX_LIMIT)
        val after = query.cursor?.let(MockCursor::decode)

        val filtered =
            rows
                .asSequence()
                .filter { row -> query.tagId == null || row.tags.any { it.id == query.tagId } }
                .filter { row -> query.source == null || row.source == query.source }
                // Sunucunun sırası: createdAt azalan, eşitlikte id azalan.
                .sortedWith(compareByDescending<Customer> { it.createdAt }.thenByDescending { it.id })
                .toList()

        // Keyset: imleçten SONRAKİ satırlar. Offset kullanmak, araya eklenen bir kaydın
        // bir satırı iki kez ya da hiç göstermesi demekti.
        val remaining =
            if (after == null) {
                filtered
            } else {
                filtered.filter { after.isBefore(it.createdAt ?: Instant.EPOCH, it.id) }
            }
        val page = remaining.take(limit)
        val hasMore = remaining.size > page.size
        val next =
            page.lastOrNull()?.takeIf { hasMore }?.let {
                MockCursor.encode(it.createdAt ?: Instant.EPOCH, it.id)
            }

        return Page(
            data = page,
            pageInfo = PageInfo(nextCursor = next, hasMore = hasMore),
        )
    }

    override suspend fun get(id: String): Customer {
        settle()
        return rows.firstOrNull { it.id == id } ?: throw MockErrors.notFound("Müşteri")
    }

    override suspend fun search(
        query: String,
        limit: Int?,
    ): List<Customer> {
        settle()

        val term = query.trim()
        // Sunucu `q >= 2` istiyor ve mock da istemeli: mock'ta geçen bir çağrının
        // canlıda 400 alması, mock'un hiç olmamasından kötüdür.
        if (term.length < MIN_SEARCH_LENGTH) {
            throw MockErrors.validation(
                path = "q",
                message = "En az $MIN_SEARCH_LENGTH karakter girin",
            )
        }

        // Türkçe katlama ve rakam eşleştirme ÜRETİM yardımcılarıyla: mock'ta "Ismail"
        // ile "İsmail"i ayrı sayan bir arama, ekranı yanlış sürerdi.
        return rows
            .filter { SearchText.matches(it.fullName, term) || SearchText.matchesDigits(it.phone, term) }
            .take((limit ?: DEFAULT_SEARCH_LIMIT).coerceIn(1, MAX_SEARCH_LIMIT))
    }

    override suspend fun create(input: CreateCustomerInput): Customer {
        settle()

        val phone = input.phone?.let(::normalizePhone)
        assertPhoneIsFree(phone, exceptId = null)

        idCounter += 1
        val created =
            Customer(
                id = "c0570000-0000-4000-8000-%012d".format(idCounter),
                fullName = input.fullName.trim(),
                phone = phone,
                email = input.email,
                birthDate = input.birthDate,
                gender = input.gender,
                notes = input.notes,
                addressLine = input.addressLine,
                district = input.district,
                city = input.city,
                postalCode = input.postalCode,
                source = input.source,
                // Yeni kayıt EN YENİDİR: listenin başında görünmeli.
                createdAt = (rows.mapNotNull { it.createdAt }.maxOrNull() ?: Instant.EPOCH).plusSeconds(1),
            )
        rows += created
        return created
    }

    override suspend fun update(
        id: String,
        input: UpdateCustomerInput,
    ): Customer {
        settle()

        val index = rows.indexOfFirst { it.id == id }
        if (index < 0) throw MockErrors.notFound("Müşteri")
        val current = rows[index]

        val phone = input.phone.resolve(current.phone)?.let(::normalizePhone)
        assertPhoneIsFree(phone, exceptId = id)

        val updated =
            current.copy(
                fullName = input.fullName?.trim() ?: current.fullName,
                phone = phone,
                email = input.email.resolve(current.email),
                birthDate = input.birthDate.resolve(current.birthDate),
                gender = input.gender ?: current.gender,
                notes = input.notes.resolve(current.notes),
                addressLine = input.addressLine.resolve(current.addressLine),
                district = input.district.resolve(current.district),
                city = input.city.resolve(current.city),
                postalCode = input.postalCode.resolve(current.postalCode),
                source = input.source.resolve(current.source),
            )
        rows[index] = updated
        return updated
    }

    override suspend fun archive(id: String): Customer {
        settle()

        val index = rows.indexOfFirst { it.id == id }
        // İkinci DELETE 404 verir: kayıt zaten listeden düşmüştür.
        if (index < 0) throw MockErrors.notFound("Müşteri")

        // Arşivleme SİLME DEĞİL — kayıt geri döndürülür ve telefon numarası serbest kalır
        // (bir sonraki `create` aynı numarayı kabul etmeli).
        return rows.removeAt(index)
    }

    override suspend fun replaceTags(
        customerId: String,
        tagIds: List<String>,
    ): Customer {
        settle()

        val index = rows.indexOfFirst { it.id == customerId }
        if (index < 0) throw MockErrors.notFound("Müşteri")

        // TAM DEĞİŞTİRME: gönderilmeyen etiket düşer. Sunucu da böyle davranıyor ve
        // mock'un "ekleme" gibi davranması, formun sildiği etiketi hayatta bırakırdı.
        val assigned = tagIds.mapNotNull { id -> tagRows.firstOrNull { it.id == id } }
        val updated = rows[index].copy(tags = assigned)
        rows[index] = updated
        return updated
    }

    override suspend fun tags(): List<CustomerTag> {
        settle()
        return tagRows.sortedBy { SearchText.fold(it.name) }
    }

    override suspend fun createTag(
        name: String,
        color: String?,
    ): CustomerTag {
        settle()
        assertTagNameIsFree(name, exceptId = null)

        idCounter += 1
        val tag =
            CustomerTag(
                id = "7a600000-0000-4000-8000-%012d".format(idCounter),
                name = name.trim(),
                color = color,
            )
        tagRows += tag
        return tag
    }

    override suspend fun updateTag(
        id: String,
        name: String?,
        color: Patch<String>,
    ): CustomerTag {
        settle()

        val index = tagRows.indexOfFirst { it.id == id }
        if (index < 0) throw MockErrors.notFound("Etiket")
        name?.let { assertTagNameIsFree(it, exceptId = id) }

        val updated =
            tagRows[index].copy(
                name = name?.trim() ?: tagRows[index].name,
                color = color.resolve(tagRows[index].color),
            )
        tagRows[index] = updated
        // Etiket adı/rengi değişince ROZETLER de değişmeli: kartta eski adı taşıyan bir
        // kopya bırakmak, aynı etiketin iki isimle görünmesi demekti.
        rows.replaceAll { row -> row.copy(tags = row.tags.map { if (it.id == id) updated else it }) }
        return updated
    }

    override suspend fun deleteTag(id: String) {
        settle()

        if (tagRows.none { it.id == id }) throw MockErrors.notFound("Etiket")
        tagRows.removeAll { it.id == id }
        // Atamalar da düşer — sunucuda FK cascade, burada elle.
        rows.replaceAll { row -> row.copy(tags = row.tags.filterNot { it.id == id }) }
    }

    override suspend fun merge(
        targetCustomerId: String,
        sourceCustomerId: String,
    ): CustomerMergeResult {
        settle()

        // Kendine birleştirme sunucuda 400. Mock kabul etseydi, ekran canlıda patlardı.
        if (targetCustomerId == sourceCustomerId) {
            throw MockErrors.validation("sourceCustomerId", "Bir kayıt kendisiyle birleştirilemez")
        }

        val targetIndex = rows.indexOfFirst { it.id == targetCustomerId }
        val sourceIndex = rows.indexOfFirst { it.id == sourceCustomerId }
        if (targetIndex < 0 || sourceIndex < 0) throw MockErrors.notFound("Müşteri")

        val target = rows[targetIndex]
        val source = rows[sourceIndex]

        // Birleştirme VERİ KAZANDIRIR: hedefin DOLU alanları kalır, boşları kaynaktan
        // dolar. Tersi, birleştirmeyi bir veri kaybı işlemine çevirirdi.
        val merged =
            target.copy(
                phone = target.phone ?: source.phone,
                email = target.email ?: source.email,
                birthDate = target.birthDate ?: source.birthDate,
                gender = target.gender ?: source.gender,
                notes = listOfNotNull(target.notes, source.notes).joinToString("\n\n").takeIf { it.isNotBlank() },
                addressLine = target.addressLine ?: source.addressLine,
                district = target.district ?: source.district,
                city = target.city ?: source.city,
                postalCode = target.postalCode ?: source.postalCode,
                source = target.source ?: source.source,
                // Etiketler BİRLEŞİR, kimliğe göre tekilleşir.
                tags = (target.tags + source.tags).distinctBy { it.id },
            )

        rows[targetIndex] = merged
        rows.removeAt(rows.indexOfFirst { it.id == sourceCustomerId })

        return CustomerMergeResult(
            id = "e6e60000-0000-4000-8000-%012d".format(++idCounter),
            sourceCustomerId = sourceCustomerId,
            targetCustomerId = targetCustomerId,
            moved =
                mapOf(
                    "appointments" to MERGED_APPOINTMENTS,
                    "customer_tag_assignments" to source.tags.count { tag -> target.tags.none { it.id == tag.id } },
                    "customer_notes" to 0,
                ),
            customer = merged,
        )
    }

    /** `Patch` → yeni değer. [Patch.Unchanged] mevcut değeri korur, [Patch.Clear] siler. */
    private fun <T> Patch<T>.resolve(current: T?): T? =
        when (this) {
            Patch.Unchanged -> current
            Patch.Clear -> null
            is Patch.Set -> value
        }

    /** Sunucu E.164'e normalize ediyor; mock etmezse ekran biçimli numarayı geri okur. */
    private fun normalizePhone(raw: String): String {
        val digits = raw.filter(Char::isDigit).removePrefix("90").let { it.removePrefix("0") }
        if (digits.length != NATIONAL_PHONE_LENGTH) {
            throw MockErrors.validation("phone", "Telefon numarası 10 haneli olmalı")
        }
        return "+90$digits"
    }

    private fun assertPhoneIsFree(
        phone: String?,
        exceptId: String?,
    ) {
        if (phone == null) return
        if (rows.any { it.phone == phone && it.id != exceptId }) {
            throw MockErrors.conflict("Bu numara kayıtlı", "Aynı telefon numarasına sahip başka bir müşteri var.")
        }
    }

    /** Tekillik KATLANMIŞ ada göre: "VIP" ile "vıp" aynı etikettir. */
    private fun assertTagNameIsFree(
        name: String,
        exceptId: String?,
    ) {
        val folded = SearchText.fold(name.trim())
        if (tagRows.any { SearchText.fold(it.name) == folded && it.id != exceptId }) {
            throw MockErrors.conflict("Bu etiket zaten var", "Aynı adlı bir etiket tanımlı.")
        }
    }

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    private companion object {
        const val MIN_LATENCY_MILLIS = 120L
        const val MAX_LATENCY_MILLIS = 400L
        const val DEFAULT_LIMIT = 50
        const val MAX_LIMIT = 200
        const val DEFAULT_SEARCH_LIMIT = 20
        const val MAX_SEARCH_LIMIT = 50
        const val MIN_SEARCH_LENGTH = 2
        const val NATIONAL_PHONE_LENGTH = 10

        /** Mock bir randevu tablosu tutmuyor; taşınan sayı temsili ama SIFIR DEĞİL. */
        const val MERGED_APPOINTMENTS = 3
    }
}

/**
 * İmleç kodlaması — `"<epoch millis>|<id>"`, base64url.
 *
 * Biçim **kasıtlı olarak opak**: ekran onu ayrıştırmıyor, saklayıp geri gönderiyor.
 * Sunucununkiyle aynı olması da gerekmiyor; taklit edilen şey biçim değil DAVRANIŞ —
 * bir sayfanın bir kaydı iki kez göstermemesi.
 */
internal data class MockCursor(
    val createdAt: Instant,
    val id: String,
) {
    /** `(createdAt, id)` azalan sırada bu imleçten SONRA mı? */
    fun isBefore(
        otherCreatedAt: Instant,
        otherId: String,
    ): Boolean =
        when {
            otherCreatedAt != createdAt -> otherCreatedAt.isBefore(createdAt)
            else -> otherId < id
        }

    companion object {
        fun encode(
            createdAt: Instant,
            id: String,
        ): String =
            Base64
                .getUrlEncoder()
                .withoutPadding()
                .encodeToString("${createdAt.toEpochMilli()}|$id".toByteArray())

        fun decode(cursor: String): MockCursor? =
            runCatching {
                val raw = String(Base64.getUrlDecoder().decode(cursor))
                val separator = raw.lastIndexOf('|')
                MockCursor(
                    createdAt = Instant.ofEpochMilli(raw.substring(0, separator).toLong()),
                    id = raw.substring(separator + 1),
                )
            }.getOrNull()
    }
}
