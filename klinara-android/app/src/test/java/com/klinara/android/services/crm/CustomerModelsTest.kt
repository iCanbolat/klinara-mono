package com.klinara.android.services.crm

import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.Page
import kotlinx.serialization.builtins.ListSerializer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * Çözümleme sözleşmesi.
 *
 * Fixture'lar sunucudan yakalanmış gerçek gövdelerdir ve **üretim çözümleyicisiyle**
 * okunur; elle kurulmuş nesneler bir sözleşme kaymasını gizlerdi.
 */
class CustomerModelsTest {
    private fun <T> decode(
        path: String,
        deserializer: kotlinx.serialization.DeserializationStrategy<T>,
    ): T = KlinaraJson.decodeFromString(deserializer, Fixtures.read(path))

    @Test
    @DisplayName("Kart tüm alanlarıyla çözülüyor — adres, kaynak, etiket")
    fun customerDecodes() {
        val customer = decode("crm/customer-with-tags.json", Customer.serializer())

        assertEquals("Ayşe Yılmaz", customer.fullName)
        assertEquals(CustomerSource.Instagram, customer.source)
        assertEquals(CustomerGender.Female, customer.gender)
        assertEquals("Bağdat Cad. 12, Kadıköy, İstanbul", customer.addressSummary)
        assertEquals(2, customer.tags.size)
        assertEquals("VIP", customer.tags.first().name)
        // Renksiz etiket geçerlidir — ekran nötr tona düşer.
        assertNull(customer.tags[1].color)
        assertEquals(Instant.parse("2026-08-14T11:23:45Z"), customer.createdAt)
    }

    @Test
    @DisplayName("`birthDate` ÇIPLAK bir string kalır — hiçbir saat dilimine uğramaz")
    fun birthDateStaysAString() {
        val customer = decode("crm/customer-with-tags.json", Customer.serializer())

        // Doğum günü bir takvim günüdür. `Instant`'a çevirmek, cihazın diliminde
        // gece yarısını kaydırıp doğum gününü bir gün öteler.
        assertEquals("1990-05-12", customer.birthDate)
    }

    @Test
    @DisplayName("Sayfa zarfı ve imleç çözülüyor")
    fun pageDecodes() {
        val page = decode("crm/customer-page.json", Page.serializer(Customer.serializer()))

        assertEquals(2, page.data.size)
        assertTrue(page.pageInfo.hasMore)
        assertNotNull(page.pageInfo.nextCursor)
    }

    @Test
    @DisplayName("Arama ÇIPLAK dizi döndürür — zarf beklemek çözümlemeyi kırar")
    fun searchIsABareArray() {
        val results =
            decode("crm/customer-search.json", ListSerializer(Customer.serializer()))
        assertEquals(1, results.size)
        assertEquals("Ayşe Yılmaz", results.first().fullName)

        // Sözleşmedeki istisnayı ÇİVİLİYORUZ: bu uç için zarf denemek HATA vermeli.
        // iOS'ta tam bu varsayım yapıldı ve arama her çağrıda sessizce kırıldı.
        assertThrows(Exception::class.java) {
            decode("crm/customer-search.json", ListEnvelope.serializer(Customer.serializer()))
        }
    }

    @Test
    @DisplayName("BİLİNMEYEN kaynak/cinsiyet çözümlemeyi düşürmez — liste boş kalmaz")
    fun unknownEnumsFallBack() {
        val customer = decode("crm/customer-forward-compatible.json", Customer.serializer())

        // Sunucuya yarın eklenecek bir değer, on bin kayıtlık listeyi düşürmemeli.
        assertEquals(CustomerSource.Unknown, customer.source)
        assertEquals(CustomerGender.Unknown, customer.gender)
        // Tanımadığımız fazladan alan da sessizce atlanmalı.
        assertEquals("Deniz Yıldız", customer.fullName)
        assertTrue(customer.isMerged)
    }

    @Test
    @DisplayName("Adres özeti boş parçaları atlar — virgül birikmez")
    fun addressSummarySkipsBlanks() {
        val customer = decode("crm/customer-page.json", Page.serializer(Customer.serializer())).data[1]

        assertEquals("Muğla", customer.addressSummary)
    }

    @Test
    @DisplayName("Hiç adresi olmayan müşteride özet null — boş string değil")
    fun addressSummaryIsNullWhenEmpty() {
        val customer = decode("crm/customer-forward-compatible.json", Customer.serializer())

        assertNull(customer.addressSummary)
    }
}
