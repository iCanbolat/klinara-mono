package com.klinara.android.features.customers

import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerGender
import com.klinara.android.services.crm.CustomerSource
import com.klinara.android.services.crm.CustomerTag
import com.klinara.android.services.crm.Patch
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/** Form kuralları — saf değer tipi, ekransız test edilir. */
class CustomerFormTest {
    private fun customer() =
        Customer(
            id = "c1",
            fullName = "Ayşe Yılmaz",
            phone = "+905321112233",
            email = "ayse@ornek.com",
            city = "İstanbul",
            gender = CustomerGender.Female,
            source = CustomerSource.Instagram,
            tags = listOf(CustomerTag(id = "t1", name = "VIP")),
        )

    @Test
    @DisplayName("Var olan kayıttan kurulan form KİRLİ DEĞİL")
    fun loadedFormIsClean() {
        val form = CustomerForm.of(customer())

        // Açılışta "kaydet" düğmesi aktif olsaydı, kullanıcı hiçbir şey değiştirmeden
        // kaydedip gereksiz bir PATCH üretebilirdi.
        assertFalse(form.isDirty)
        assertFalse(form.tagsChanged)
        assertTrue(form.isValid)
    }

    @Test
    @DisplayName("Ad boşsa form GEÇERSİZ")
    fun nameIsRequired() {
        assertFalse(CustomerForm.empty().isValid)
        assertFalse(CustomerForm.of(customer()).copy(fullName = "   ").isValid)
    }

    @Test
    @DisplayName("Yalnız DEĞİŞEN alan gövdeye girer")
    fun onlyChangedFieldsArePatched() {
        val form = CustomerForm.of(customer()).copy(city = "İzmir")
        val input = form.updateInput()

        assertEquals(Patch.Set("İzmir"), input.city)
        // Dokunulmayanlar `Unchanged`: gövdede hiç görünmeyecekler.
        assertEquals(Patch.Unchanged, input.email)
        assertEquals(Patch.Unchanged, input.phone)
        assertNull(input.fullName)
    }

    @Test
    @DisplayName("Boşaltılan alan TEMİZLEME üretir — sunucuda silinir")
    fun clearedFieldBecomesClear() {
        val form = CustomerForm.of(customer()).copy(city = "")

        // Bu testin varlık sebebi: `Unchanged` üretseydi kullanıcı alanı siler,
        // kaydeder ve değer yerinde kalırdı.
        assertEquals(Patch.Clear, form.updateInput().city)
    }

    @Test
    @DisplayName("Hiç değişiklik yoksa gövde BOŞ")
    fun untouchedFormProducesAnEmptyPatch() {
        assertTrue(CustomerForm.of(customer()).updateInput().isEmpty)
    }

    @Test
    @DisplayName("Etiket değişimi AYRI izlenir — gövde onları taşımıyor")
    fun tagChangesAreTrackedSeparately() {
        val form = CustomerForm.of(customer()).toggleTag("t2")

        assertTrue(form.tagsChanged)
        // Etiketler ikinci bir istekle (`PUT .../tags`) gider; gövdeyi kirletmezler.
        assertTrue(form.updateInput().isEmpty)
    }

    @Test
    @DisplayName("Aynı etikete iki kez dokunmak seçimi geri alır")
    fun togglingATagTwiceRestoresIt() {
        val form = CustomerForm.of(customer())

        assertFalse(form.toggleTag("t1").toggleTag("t1").tagsChanged)
    }

    @Test
    @DisplayName("Geçersiz e-posta ekranda yakalanır — ağa gidip dönmeden")
    fun emailIsValidatedLocally() {
        assertNotNull(CustomerForm.empty().copy(fullName = "A", email = "ayse@").emailError)
        assertNotNull(CustomerForm.empty().copy(fullName = "A", email = "ayse.com").emailError)
        assertNull(CustomerForm.empty().copy(fullName = "A", email = "ayse@ornek.com").emailError)
        // Boş e-posta hata DEĞİL: alan zorunlu değil.
        assertNull(CustomerForm.empty().copy(fullName = "A", email = "").emailError)
    }

    @Test
    @DisplayName("Doğum tarihi `YYYY-MM-DD` bekler")
    fun birthDateFormatIsChecked() {
        assertNotNull(CustomerForm.empty().copy(fullName = "A", birthDate = "12.05.1990").birthDateError)
        assertNull(CustomerForm.empty().copy(fullName = "A", birthDate = "1990-05-12").birthDateError)
        assertNull(CustomerForm.empty().copy(fullName = "A", birthDate = "").birthDateError)
    }

    @Test
    @DisplayName("Oluşturma gövdesinde boş alanlar null olur, boş string değil")
    fun createInputDropsBlanks() {
        val input = CustomerForm.empty().copy(fullName = "  Ayşe  ", city = "   ").createInput()

        assertEquals("Ayşe", input.fullName)
        // Boş string göndermek sunucuda `""` bırakır: ekranda boş görünen ama dolu bir alan.
        assertNull(input.city)
    }

    @Test
    @DisplayName("Yalnız boşluk eklemek formu KİRLETMEZ")
    fun whitespaceOnlyEditsAreNotDirty() {
        assertFalse(CustomerForm.of(customer()).copy(fullName = "Ayşe Yılmaz  ").isDirty)
    }
}
