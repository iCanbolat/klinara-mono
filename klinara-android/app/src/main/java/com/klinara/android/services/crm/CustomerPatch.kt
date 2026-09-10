package com.klinara.android.services.crm

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Kısmi güncellemenin ÜÇ durumu.
 *
 * `PATCH customers/:id` üç şeyi ayırt eder ve ikisi aynı Kotlin değeriyle temsil
 * edilemez:
 *
 * | Niyet | Gövde | Sunucu ne yapar |
 * |---|---|---|
 * | Dokunma | alan **hiç yok** | değeri korur |
 * | Değiştir | `"city": "İzmir"` | yazar |
 * | **Temizle** | `"city": null` | **siler** |
 *
 * Bir `String?` bunu taşıyamaz: `null` "dokunma" mı "temizle" mi belli olmaz. Üstelik
 * `KlinaraJson` `explicitNulls = false` ile kurulu, yani bir data class'taki `null`
 * alan gövdeden **atılır** — yani `String?` ile temizlemek imkânsızdır, sessizce
 * "dokunma"ya döner. Kullanıcı adresi siler, kaydeder, adres yerinde durur.
 *
 * `LiveBookingService.updateNotes` aynı sorunu tek alan için elle çözmüştü
 * (`buildJsonObject { put("notes", JsonNull) }`); bu tip onu genelleştiriyor.
 *
 * iOS `Nullable<Value>` paritesi.
 */
sealed interface Patch<out T> {
    /** Alan gövdeye HİÇ yazılmaz. */
    data object Unchanged : Patch<Nothing>

    data class Set<T>(val value: T) : Patch<T>

    /** Alan gövdeye açık `null` olarak yazılır — sunucu siler. */
    data object Clear : Patch<Nothing>

    companion object {
        /**
         * Metin alanları için: boş ya da yalnız boşluk **temizleme** sayılır.
         *
         * Bir form alanını boşaltıp kaydetmek "burayı sil" demektir; boş bir string
         * göndermek sunucuda `""` bırakır ve ekranda boş görünen ama dolu olan bir
         * alan üretirdi.
         */
        fun text(value: String?): Patch<String> =
            value?.trim()?.takeIf { it.isNotEmpty() }?.let { Set(it) } ?: Clear

        /** Değer varsa yaz, yoksa temizle. Enum ve benzeri alanlar için. */
        fun <T> orClear(value: T?): Patch<T> = if (value == null) Clear else Set(value)
    }
}

/**
 * Bir [Patch] alanını gövdeye yazar — [Patch.Unchanged] ise HİÇBİR ŞEY yazmaz.
 *
 * `encode` lambdası değeri `JsonObjectBuilder`ın anladığı bir ilkel'e çevirir; enum'lar
 * için `it.wire`, metinler için kendisi.
 */
internal fun <T> JsonObjectBuilder.putPatch(
    key: String,
    patch: Patch<T>,
    encode: (T) -> String,
) {
    when (patch) {
        Patch.Unchanged -> Unit
        Patch.Clear -> put(key, JsonNull)
        is Patch.Set -> put(key, encode(patch.value))
    }
}

/**
 * [putPatch]'in sayı ve boolean gibi metin OLMAYAN alanlar için hâli.
 *
 * `putPatch` değeri daima metne çeviriyor; paket tanımının `validityDays`'i gibi bir
 * sayıyı `"365"` olarak göndermek sunucuda 400 alırdı. İmzayı değiştirmek yerine ayrı bir
 * fonksiyon: var olan onlarca çağıran `{ it }` yazmaya devam ediyor.
 */
internal fun <T> JsonObjectBuilder.putPatchElement(
    key: String,
    patch: Patch<T>,
    encode: (T) -> JsonElement,
) {
    when (patch) {
        Patch.Unchanged -> Unit
        Patch.Clear -> put(key, JsonNull)
        is Patch.Set -> put(key, encode(patch.value))
    }
}

/**
 * Müşteri güncelleme gövdesi.
 *
 * ⚠️ [fullName] ve [gender] **`Patch` DEĞİL**: sunucu kolonları nullable değil ve
 * temizlenemezler. Onlara `Patch` vermek, çalışma anında 400 alacak bir niyeti
 * derleme zamanında ifade edilebilir kılmak olurdu.
 */
data class UpdateCustomerInput(
    val fullName: String? = null,
    val phone: Patch<String> = Patch.Unchanged,
    val email: Patch<String> = Patch.Unchanged,
    val birthDate: Patch<String> = Patch.Unchanged,
    val gender: CustomerGender? = null,
    val notes: Patch<String> = Patch.Unchanged,
    val addressLine: Patch<String> = Patch.Unchanged,
    val district: Patch<String> = Patch.Unchanged,
    val city: Patch<String> = Patch.Unchanged,
    val postalCode: Patch<String> = Patch.Unchanged,
    val source: Patch<CustomerSource> = Patch.Unchanged,
) {
    /**
     * Hiçbir alan değişmemiş mi?
     *
     * Boş bir `PATCH` göndermek zararsız değil: sunucuya gereksiz bir yazma, kullanıcıya
     * gereksiz bir bekleme ve kayda gereksiz bir `updatedAt` demek.
     */
    val isEmpty: Boolean
        get() =
            fullName == null &&
                gender == null &&
                listOf(phone, email, birthDate, notes, addressLine, district, city, postalCode, source)
                    .all { it == Patch.Unchanged }

    fun toJson(): JsonObject =
        buildJsonObject {
            fullName?.let { put("fullName", it) }
            gender?.let { put("gender", it.wire) }
            putPatch("phone", phone) { it }
            putPatch("email", email) { it }
            putPatch("birthDate", birthDate) { it }
            putPatch("notes", notes) { it }
            putPatch("addressLine", addressLine) { it }
            putPatch("district", district) { it }
            putPatch("city", city) { it }
            putPatch("postalCode", postalCode) { it }
            putPatch("source", source) { it.wire }
        }
}

/**
 * Müşteri oluşturma gövdesi.
 *
 * Burada [Patch] YOK ve olması da anlamsız: var olmayan bir kaydın alanı "temizlenemez".
 * Gönderilmeyen alan boş doğar.
 */
data class CreateCustomerInput(
    val fullName: String,
    val phone: String? = null,
    val email: String? = null,
    val birthDate: String? = null,
    val gender: CustomerGender? = null,
    val notes: String? = null,
    val addressLine: String? = null,
    val district: String? = null,
    val city: String? = null,
    val postalCode: String? = null,
    val source: CustomerSource? = null,
) {
    fun toJson(): JsonObject =
        buildJsonObject {
            put("fullName", fullName)
            phone?.let { put("phone", it) }
            email?.let { put("email", it) }
            birthDate?.let { put("birthDate", it) }
            gender?.let { put("gender", it.wire) }
            notes?.let { put("notes", it) }
            addressLine?.let { put("addressLine", it) }
            district?.let { put("district", it) }
            city?.let { put("city", it) }
            postalCode?.let { put("postalCode", it) }
            source?.let { put("source", it.wire) }
        }
}

/** `POST customers/:targetId/merge` sonucu. */
@kotlinx.serialization.Serializable
data class CustomerMergeResult(
    val id: String,
    val sourceCustomerId: String,
    val targetCustomerId: String,
    /** Tablo adı → taşınan satır sayısı. */
    val moved: Map<String, Int> = emptyMap(),
    val customer: Customer,
) {
    /**
     * "12 randevu · 2 etiket" — kullanıcıya NE TAŞINDIĞINI söyler.
     *
     * Sıfırlar atılıyor: "0 dosya taşındı" bilgi değil gürültüdür.
     */
    val movedSummary: String?
        get() =
            moved
                .filterValues { it > 0 }
                .toList()
                .sortedByDescending { it.second }
                .mapNotNull { (table, count) -> TABLE_LABELS[table]?.let { "$count $it" } }
                .takeIf { it.isNotEmpty() }
                ?.joinToString(" · ")

    private companion object {
        /**
         * Tablo adı → Türkçe etiket.
         *
         * Listede olmayan bir tablo GÖSTERİLMEZ: sunucu yarın yeni bir FK taşırsa
         * kullanıcıya `customer_consents` yazmaktansa hiç yazmamak yeğdir.
         */
        val TABLE_LABELS =
            mapOf(
                "appointments" to "randevu",
                "customer_bookings" to "rezervasyon",
                "customer_notes" to "not",
                "customer_files" to "dosya",
                "customer_file_groups" to "fotoğraf grubu",
                "customer_tag_assignments" to "etiket",
                "customer_packages" to "paket",
                "payments" to "tahsilat",
            )
    }
}
