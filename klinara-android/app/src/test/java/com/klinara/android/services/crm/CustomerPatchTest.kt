package com.klinara.android.services.crm

import com.klinara.android.services.networking.KlinaraJson
import kotlinx.serialization.json.JsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * Kısmi güncellemenin ÜÇ durumu.
 *
 * Bu testin varlık sebebi: `explicitNulls = false` yüzünden bir `String?` ile
 * "temizle" niyeti gövdeden **sessizce düşer**. Kullanıcı adresi siler, kaydeder, adres
 * yerinde durur — ve bunu ancak müşteri şikâyet edince fark ederiz.
 */
class CustomerPatchTest {
    private fun json(input: UpdateCustomerInput): String =
        KlinaraJson.encodeToString(JsonObject.serializer(), input.toJson())

    @Test
    @DisplayName("DOKUNULMAYAN alan gövdede HİÇ YOK")
    fun unchangedIsAbsent() {
        val body = json(UpdateCustomerInput(city = Patch.Unchanged))

        assertFalse(body.contains("city"))
        assertEquals("{}", body)
    }

    @Test
    @DisplayName("DEĞİŞTİRİLEN alan değerini taşır")
    fun setCarriesTheValue() {
        val body = json(UpdateCustomerInput(city = Patch.Set("İzmir")))

        assertTrue(body.contains("\"city\":\"İzmir\""))
    }

    @Test
    @DisplayName("TEMİZLENEN alan açık `null` taşır — sunucu siler")
    fun clearIsAnExplicitNull() {
        val body = json(UpdateCustomerInput(city = Patch.Clear))

        // Alanın atlanması "dokunma" demekti; silmenin TEK yolu açık null.
        assertTrue(body.contains("\"city\":null"))
    }

    @Test
    @DisplayName("Üç durum ÜÇ AYRI gövde üretir — ikisi çakışmaz")
    fun theThreeStatesAreDistinct() {
        val unchanged = json(UpdateCustomerInput(city = Patch.Unchanged))
        val set = json(UpdateCustomerInput(city = Patch.Set("İzmir")))
        val cleared = json(UpdateCustomerInput(city = Patch.Clear))

        assertEquals(3, setOf(unchanged, set, cleared).size)
    }

    @Test
    @DisplayName("`Patch.text` boş metni TEMİZLEME sayar")
    fun blankTextClears() {
        assertEquals(Patch.Clear, Patch.text(""))
        assertEquals(Patch.Clear, Patch.text("   "))
        assertEquals(Patch.Clear, Patch.text(null))
        assertEquals(Patch.Set("İzmir"), Patch.text("  İzmir  "))
    }

    @Test
    @DisplayName("`fullName` ve `gender` Patch DEĞİL — temizlenemezler")
    fun nonNullableColumnsAreNotPatchable() {
        // Sunucu kolonları nullable değil; onlara Patch vermek, çalışma anında 400
        // alacak bir niyeti derleme zamanında ifade edilebilir kılmak olurdu.
        val body = json(UpdateCustomerInput(fullName = "Ayşe Yılmaz", gender = CustomerGender.Female))

        assertTrue(body.contains("\"fullName\":\"Ayşe Yılmaz\""))
        assertTrue(body.contains("\"gender\":\"female\""))
        assertFalse(body.contains("null"))
    }

    @Test
    @DisplayName("Enum alanı `wire` değeriyle yazılır, Kotlin adıyla değil")
    fun enumsUseWireValues() {
        val body = json(UpdateCustomerInput(source = Patch.Set(CustomerSource.WalkIn)))

        assertTrue(body.contains("\"source\":\"walk_in\""))
    }

    @Test
    @DisplayName("Hiçbir alan değişmemişse `isEmpty` — boş PATCH atılmaz")
    fun emptyPatchIsDetected() {
        assertTrue(UpdateCustomerInput().isEmpty)
        assertFalse(UpdateCustomerInput(city = Patch.Clear).isEmpty)
        assertFalse(UpdateCustomerInput(fullName = "Ayşe").isEmpty)
    }

    @Test
    @DisplayName("Birleştirme özeti SIFIRLARI atar ve çoktan aza sıralar")
    fun mergeSummaryDropsZeros() {
        val result =
            CustomerMergeResult(
                id = "m1",
                sourceCustomerId = "s",
                targetCustomerId = "t",
                moved = mapOf("customer_tag_assignments" to 2, "appointments" to 12, "customer_notes" to 0),
                customer = Customer(id = "t", fullName = "Ayşe Yılmaz"),
            )

        // "0 not taşındı" bilgi değil gürültüdür.
        assertEquals("12 randevu · 2 etiket", result.movedSummary)
    }

    @Test
    @DisplayName("Hiç kayıt taşınmadıysa özet null — 'hiçbir şey' diye yazmaz")
    fun mergeSummaryIsNullWhenNothingMoved() {
        val result =
            CustomerMergeResult(
                id = "m1",
                sourceCustomerId = "s",
                targetCustomerId = "t",
                moved = mapOf("appointments" to 0),
                customer = Customer(id = "t", fullName = "Ayşe"),
            )

        assertEquals(null, result.movedSummary)
    }
}
