package com.klinara.android.features.customers

import com.klinara.android.services.crm.CreateCustomerInput
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerGender
import com.klinara.android.services.crm.CustomerSource
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.crm.UpdateCustomerInput

/**
 * Müşteri formunun durumu — **saf bir değer tipi**.
 *
 * Kuralların yaşadığı yer burası, ekran değil: geçerlilik, kirlilik ve gövde üretimi
 * `@Composable` olmayan bir tipte durduğu için testi ucuz ve iki ekrandan
 * (oluşturma/düzenleme) aynı şekilde sürülüyor. `BookingDraft` ile aynı desen.
 */
data class CustomerForm(
    val fullName: String = "",
    val phoneE164: String = "",
    val email: String = "",
    val birthDate: String = "",
    val gender: CustomerGender? = null,
    val notes: String = "",
    val addressLine: String = "",
    val district: String = "",
    val city: String = "",
    val postalCode: String = "",
    val source: CustomerSource? = null,
    val tagIds: Set<String> = emptySet(),
    private val original: Snapshot = Snapshot(),
) {
    /** Karşılaştırma için dondurulmuş ilk hâl — `isDirty` bunun üstünden çalışır. */
    data class Snapshot(
        val fullName: String = "",
        val phoneE164: String = "",
        val email: String = "",
        val birthDate: String = "",
        val gender: CustomerGender? = null,
        val notes: String = "",
        val addressLine: String = "",
        val district: String = "",
        val city: String = "",
        val postalCode: String = "",
        val source: CustomerSource? = null,
        val tagIds: Set<String> = emptySet(),
    )

    /** Ad zorunlu; sunucu da öyle diyor ve boş bir adla kaydetmek 400 almak olurdu. */
    val isValid: Boolean get() = fullName.isNotBlank() && emailError == null && birthDateError == null

    /**
     * E-posta biçimi.
     *
     * Sunucu doğruluyor ama ekranda da kontrol var: yanlış bir e-postayı ağa gidip
     * dönmeden söylemek, kullanıcının o alanda kalmasını sağlar.
     */
    val emailError: String?
        get() {
            val value = email.trim()
            if (value.isEmpty()) return null
            val at = value.indexOf('@')
            val valid = at > 0 && value.indexOf('.', at) > at + 1 && !value.endsWith('.')
            return if (valid) null else "Geçerli bir e-posta girin"
        }

    /** `YYYY-MM-DD` — sunucunun beklediği çıplak tarih biçimi. */
    val birthDateError: String?
        get() {
            val value = birthDate.trim()
            if (value.isEmpty()) return null
            return if (BIRTH_DATE_PATTERN.matches(value)) null else "Tarihi GG.AA.YYYY olarak girin"
        }

    val isDirty: Boolean
        get() = snapshot() != original

    /**
     * Etiketler AYRI bir istekle gider (`PUT .../tags`) ve ayrı izlenir: gövde onları
     * taşımıyor, dolayısıyla "değişti mi" sorusu da ayrı sorulmalı.
     */
    val tagsChanged: Boolean get() = tagIds != original.tagIds

    fun toggleTag(id: String): CustomerForm =
        copy(tagIds = if (id in tagIds) tagIds - id else tagIds + id)

    fun createInput(): CreateCustomerInput =
        CreateCustomerInput(
            fullName = fullName.trim(),
            phone = phoneE164.trimOrNull(),
            email = email.trimOrNull(),
            birthDate = birthDate.trimOrNull(),
            gender = gender,
            notes = notes.trimOrNull(),
            addressLine = addressLine.trimOrNull(),
            district = district.trimOrNull(),
            city = city.trimOrNull(),
            postalCode = postalCode.trimOrNull(),
            source = source,
        )

    /**
     * Yalnız DEĞİŞEN alanları taşıyan gövde.
     *
     * Değişmeyen alan `Patch.Unchanged` kalır ve gövdeye hiç yazılmaz; boşaltılan bir
     * alan `Patch.Clear` olur ve sunucuda **silinir**. Hepsini `Set` göndermek, iki
     * kişinin aynı kaydı düzenlediği durumda dokunmadığınız alanı da geri yazmak olurdu.
     */
    fun updateInput(): UpdateCustomerInput =
        UpdateCustomerInput(
            fullName = fullName.trim().takeIf { it != original.fullName },
            phone = patchOf(phoneE164, original.phoneE164),
            email = patchOf(email, original.email),
            birthDate = patchOf(birthDate, original.birthDate),
            gender = gender.takeIf { it != original.gender },
            notes = patchOf(notes, original.notes),
            addressLine = patchOf(addressLine, original.addressLine),
            district = patchOf(district, original.district),
            city = patchOf(city, original.city),
            postalCode = patchOf(postalCode, original.postalCode),
            source = if (source == original.source) Patch.Unchanged else Patch.orClear(source),
        )

    private fun patchOf(
        current: String,
        before: String,
    ): Patch<String> = if (current.trim() == before.trim()) Patch.Unchanged else Patch.text(current)

    private fun snapshot() =
        Snapshot(
            fullName.trim(), phoneE164.trim(), email.trim(), birthDate.trim(), gender,
            notes.trim(), addressLine.trim(), district.trim(), city.trim(), postalCode.trim(),
            source, tagIds,
        )

    private fun String.trimOrNull(): String? = trim().takeIf { it.isNotEmpty() }

    companion object {
        private val BIRTH_DATE_PATTERN = Regex("""^\d{4}-\d{2}-\d{2}$""")

        /** Boş form — yeni müşteri. */
        fun empty(): CustomerForm = CustomerForm()

        /** Var olan kayıttan; `original` aynı değerlerle dolar, yani form KİRLİ DEĞİL. */
        fun of(customer: Customer): CustomerForm {
            val snapshot =
                Snapshot(
                    fullName = customer.fullName,
                    phoneE164 = customer.phone.orEmpty(),
                    email = customer.email.orEmpty(),
                    birthDate = customer.birthDate.orEmpty(),
                    gender = customer.gender,
                    notes = customer.notes.orEmpty(),
                    addressLine = customer.addressLine.orEmpty(),
                    district = customer.district.orEmpty(),
                    city = customer.city.orEmpty(),
                    postalCode = customer.postalCode.orEmpty(),
                    source = customer.source,
                    tagIds = customer.tags.map { it.id }.toSet(),
                )
            return CustomerForm(
                fullName = snapshot.fullName,
                phoneE164 = snapshot.phoneE164,
                email = snapshot.email,
                birthDate = snapshot.birthDate,
                gender = snapshot.gender,
                notes = snapshot.notes,
                addressLine = snapshot.addressLine,
                district = snapshot.district,
                city = snapshot.city,
                postalCode = snapshot.postalCode,
                source = snapshot.source,
                tagIds = snapshot.tagIds,
                original = snapshot,
            )
        }
    }
}
