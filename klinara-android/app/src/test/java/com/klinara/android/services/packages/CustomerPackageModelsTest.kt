package com.klinara.android.services.packages

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.Page
import kotlinx.serialization.builtins.ListSerializer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

class CustomerPackageModelsTest {
    private fun <T> decode(
        path: String,
        deserializer: kotlinx.serialization.DeserializationStrategy<T>,
    ): T = KlinaraJson.decodeFromString(deserializer, Fixtures.read(path))

    private val pkg get() = decode("packages/customer-package.json", CustomerPackage.serializer())

    @Test
    @DisplayName("Paket kalemleriyle çözülüyor; bakiye KALEM bazında ve toplamla tutarlı")
    fun packageDecodesPerItem() {
        val laser = pkg.sortedItems[0]
        val skin = pkg.sortedItems[1]

        assertEquals(6, laser.remainingSessions)
        assertEquals(1, skin.remainingSessions)
        assertEquals(pkg.remainingSessions, pkg.items.sumOf { it.remainingSessions })
        assertEquals(12, pkg.totalSessions)
        // İade/yükümlülük satış tahsisinden: 1.111.963 / 10 = 111.196 (kuruş, taban).
        assertEquals(111_196L, laser.unitAllocationMinor)
        assertEquals(4, laser.usedSessions)
    }

    @Test
    @DisplayName("Süresi geçmiş paket durum hâlâ 'active' olsa da SÜRESİ DOLMUŞ sayılıyor")
    fun expiryLooksAtTheDateNotOnlyStatus() {
        val afterExpiry = Instant.parse("2027-07-11T00:00:00Z")

        assertTrue(pkg.isExpired(afterExpiry), "Kapatma bir cron işi; ekran tarihe bakmalı")
        assertFalse(pkg.isConsumable(afterExpiry))
        assertTrue(pkg.isConsumable(Instant.parse("2026-09-11T00:00:00Z")))
        assertTrue(pkg.expiresSoon(Instant.parse("2027-06-20T00:00:00Z")))
        assertFalse(pkg.expiresSoon(Instant.parse("2027-01-01T00:00:00Z")))
    }

    @Test
    @DisplayName("Sayfa çözülüyor; iade edilmiş paket kapalı")
    fun pageDecodesRefunded() {
        val page = decode("packages/customer-package-page.json", Page.serializer(CustomerPackage.serializer()))
        val refunded = page.data[1]

        assertEquals(CustomerPackageStatus.Refunded, refunded.status)
        assertFalse(refunded.status.isOpen)
        assertEquals(0, refunded.remainingSessions)
    }

    @Test
    @DisplayName("Defter çözülüyor; ters kayıt işaretli ve imleç okunuyor")
    fun ledgerDecodes() {
        val page = decode("packages/package-ledger.json", Page.serializer(PackageLedgerEntry.serializer()))
        val reversal = page.data.first()

        assertTrue(reversal.isReversal)
        assertEquals("+1", reversal.signedDelta)
        assertEquals("-1", page.data[1].signedDelta)
        assertEquals("bGVkZ2VyLTM", page.pageInfo.nextCursor)
    }

    @Test
    @DisplayName("Bilinmeyen defter türü Unknown'a düşüyor, çözümleme PATLAMIYOR, delta korunuyor")
    fun unknownLedgerTypeFallsBack() {
        val page = decode("packages/ledger-unknown-kind.json", Page.serializer(PackageLedgerEntry.serializer()))
        val entry = page.data.single()

        assertEquals(LedgerEntryType.Unknown, entry.entryType)
        // Yutulmuyor: satır deltasıyla "bilinmeyen işlem" olarak çizilecek.
        assertEquals(2, entry.delta)
    }

    @Test
    @DisplayName("Kullanılabilir haklar ÇIPLAK dizi — zarf beklemek çözümlemeyi kırar")
    fun entitlementsAreABareArray() {
        val list = decode("packages/package-entitlements.json", ListSerializer(PackageEntitlement.serializer()))

        assertEquals(6, list.single().remainingSessions)
        val envelope = ListEnvelope.serializer(PackageEntitlement.serializer())
        val enveloped = runCatching { decode("packages/package-entitlements.json", envelope) }
        assertTrue(enveloped.isFailure, "iOS'ta bir kez ezberden zarf beklenip kırılmıştı")
    }

    @Test
    @DisplayName("PACKAGE_EXHAUSTED ve PACKAGE_EXPIRED için Türkçe, eyleme dönük mesaj var")
    fun packageErrorsHaveMessages() {
        val exhausted = MockErrors.packageExhausted()
        val expired = MockErrors.packageExpired()

        assertEquals(ApiErrorCode.PACKAGE_EXHAUSTED, exhausted.code)
        assertTrue(exhausted.displayMessage.contains("seans"))
        assertNotEquals(exhausted.displayMessage, expired.displayMessage)
    }

    @Test
    @DisplayName("Satış gövdesi şube TAŞIMIYOR — `X-Branch-Id` başlıktan gidiyor")
    fun sellBodyHasNoBranch() {
        val body = CreateCustomerPackageInput("c1", "d1").toJson()

        assertEquals(setOf("customerId", "definitionId"), body.keys)
    }
}
