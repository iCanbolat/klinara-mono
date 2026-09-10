package com.klinara.android.services.crm

import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * Mock'un sunucuyla AYNI kurallara uyduğunu doğrular.
 *
 * Mock'ta geçen bir akışın canlıda patlaması, mock'un hiç olmamasından kötüdür:
 * geliştirici o akışı çalışıyor sanarak ilerler.
 */
class MockCustomerServiceTest {
    private fun subject() = MockCustomerService(latencyEnabled = false)

    @Test
    @DisplayName("İmleç bir kaydı İKİ KEZ göstermez ve hiçbirini atlamaz")
    fun cursorDoesNotRepeatOrSkip() =
        runTest {
            val service = subject()
            val seen = mutableListOf<String>()

            var cursor: String? = null
            do {
                val page = service.list(CustomerListQuery(limit = 3, cursor = cursor))
                seen += page.data.map { it.id }
                cursor = page.pageInfo.nextCursor
            } while (cursor != null)

            // Sayfalama bir gezinmedir: her kayıt tam olarak bir kez görünmeli.
            assertEquals(MockCustomers.ALL.size, seen.size)
            assertEquals(seen.size, seen.toSet().size)
            assertEquals(MockCustomers.ALL.map { it.id }.toSet(), seen.toSet())
        }

    @Test
    @DisplayName("Son sayfada `hasMore` false ve imleç null")
    fun lastPageClosesTheCursor() =
        runTest {
            val page = subject().list(CustomerListQuery(limit = MockCustomers.ALL.size))

            assertFalse(page.pageInfo.hasMore)
            assertNull(page.pageInfo.nextCursor)
        }

    @Test
    @DisplayName("Liste `createdAt` AZALAN sırada — en yeni kayıt başta")
    fun listIsNewestFirst() =
        runTest {
            val page = subject().list(CustomerListQuery(limit = 100))
            val dates = page.data.mapNotNull { it.createdAt }

            assertEquals(dates.sortedDescending(), dates)
        }

    @Test
    @DisplayName("Arama Türkçe katlıyor: `YILMAZ` → `Ayşe Yılmaz`")
    fun searchFoldsTurkish() =
        runTest {
            // `lowercase()` bu dilde çalışmaz: "YILMAZ" noktalı, "Yılmaz" noktasız iner.
            val results = subject().search("YILMAZ")

            assertTrue(results.any { it.fullName == "Ayşe Yılmaz" })
        }

    @Test
    @DisplayName("Arama biçimli numarayı da bulur: `0532 111 22 33`")
    fun searchMatchesFormattedDigits() =
        runTest {
            val results = subject().search("0532 111 22 33")

            assertTrue(results.any { it.phone == "+905321112233" })
        }

    @Test
    @DisplayName("İki karakterden kısa arama SUNUCU GİBİ reddedilir")
    fun shortSearchIsRejected() =
        runTest {
            // Sunucu `q >= 2` istiyor. Mock kabul etseydi, ekran canlıda 400 alırdı.
            val error =
                runCatching { subject().search("a") }.exceptionOrNull()

            assertTrue(error is ApiError.Problem)
            assertEquals("q", (error as ApiError.Problem).fieldErrors.keys.first())
        }

    @Test
    @DisplayName("Etiket filtresi yalnız o etiketi taşıyanları döndürür")
    fun tagFilterNarrows() =
        runTest {
            val vip = MockCustomers.Tags.VIP
            val page = subject().list(CustomerListQuery(tagId = vip.id, limit = 100))

            assertTrue(page.data.isNotEmpty())
            assertTrue(page.data.all { customer -> customer.tags.any { it.id == vip.id } })
        }

    @Test
    @DisplayName("Bilinmeyen kimlik 404 verir, boş kayıt değil")
    fun unknownIdIsNotFound() =
        runTest {
            val error = runCatching { subject().get("yok") }.exceptionOrNull()

            assertNotNull(error)
            assertTrue(error is ApiError.Problem)
        }
}
