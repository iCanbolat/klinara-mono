package com.klinara.android.services.packages

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * Düzeltme, iade ve devir — fazın çıkış ölçütünün asıl sınandığı yer: hiçbir işlem kalan
 * hakkı eksiye düşürmüyor ve hiçbir işlemden sonra kalan hak defterle ayrışmıyor.
 */
class MockPackageOperationsTest {
    private val service = MockPackagesService(latencyEnabled = false)
    private val laser = MockPackagesSeed.SOLD_AYSE_ITEM_LASER
    private val skin = MockPackagesSeed.SOLD_AYSE_ITEM_SKIN
    private val zeynep = MockCustomers.ALL[1].id

    private suspend fun ayse() = service.customerPackage(MockPackagesSeed.SOLD_AYSE_PACKAGE)

    private suspend fun assertLedgerMatches(packageId: String) {
        val pkg = service.customerPackage(packageId)
        val ledger = service.ledger(packageId).data
        pkg.items.forEach { item ->
            val sum = ledger.filter { it.customerPackageItemId == item.id }.sumOf { it.delta }
            assertEquals(item.remainingSessions, sum)
            assertTrue(item.remainingSessions >= 0)
        }
    }

    private fun change(
        vararg deltas: Pair<String, Int>,
        reason: String = "Test düzeltmesi",
    ) = AdjustPackageInput(deltas.map { AdjustItemInput(it.first, it.second) }, reason)

    private fun sessions(
        itemId: String,
        count: Int,
    ) = listOf(SessionsItemInput(itemId, count))

    private suspend fun adjust(
        pkg: CustomerPackage,
        input: AdjustPackageInput,
    ) = service.adjust(pkg.id, pkg.version, input)

    private suspend fun codeOf(block: suspend () -> Unit): ApiErrorCode? =
        try {
            block()
            null
        } catch (error: ApiError) {
            error.code
        }

    @Test
    @DisplayName("Hak yetersizken düzeltme PACKAGE_EXHAUSTED veriyor ve HİÇBİR kalem değişmiyor")
    fun adjustBeyondRemainingIsRejectedAtomically() =
        runTest {
            val before = ayse()
            // Lazer için geçerli (+1), bakım için yetersiz (−2 > kalan 1) — ikisi birlikte.
            val input = change(laser to 1, skin to -2)

            val code = codeOf { service.adjust(before.id, before.version, input) }

            assertEquals(ApiErrorCode.PACKAGE_EXHAUSTED, code)
            val remaining = ayse().sortedItems.map { it.remainingSessions }
            assertEquals(before.sortedItems.map { it.remainingSessions }, remaining)
            assertLedgerMatches(before.id)
        }

    @Test
    @DisplayName("Düzeltme deftere gerekçesiyle `manual_adjustment` yazıyor ve sürümü artırıyor")
    fun adjustWritesManualEntry() =
        runTest {
            val before = ayse()

            val after = adjust(before, change(laser to 2, reason = "Cihaz arızası telafisi"))

            val top = service.ledger(before.id).data.first()
            assertEquals(LedgerEntryType.ManualAdjustment, top.entryType)
            assertEquals("Cihaz arızası telafisi", top.reason)
            assertEquals(8, after.sortedItems[0].remainingSessions)
            assertEquals(before.version + 1, after.version)
            assertLedgerMatches(before.id)
        }

    @Test
    @DisplayName("Bayat sürümle düzeltme VERSION_CONFLICT — iki kişi aynı paketi düzeltemez")
    fun staleAdjustConflicts() =
        runTest {
            val before = ayse()
            adjust(before, change(laser to 1))

            val code =
                codeOf { adjust(before, change(laser to 1)) }

            assertEquals(ApiErrorCode.VERSION_CONFLICT, code)
        }

    @Test
    @DisplayName("Kısmi iade: tutar SATIŞ TAHSİSİNDEN, paket açık kalıyor")
    fun partialRefund() =
        runTest {
            val before = ayse()
            val input = RefundPackageInput(listOf(SessionsItemInput(laser, 2)), "Müşteri taşınıyor")

            val result = service.refund(before.id, before.version, input, idempotencyKey = "iade-1")
            val after = ayse()

            // 1.111.963 / 10 = 111.196 × 2 — liste fiyatı (145.000 × 2) DEĞİL.
            assertEquals(222_392L, result.refundAmountMinor)
            assertEquals(4, after.sortedItems[0].remainingSessions)
            assertEquals(CustomerPackageStatus.Active, after.status)
            assertLedgerMatches(before.id)
        }

    @Test
    @DisplayName("Tam iade tüm kalanı sıfırlıyor, paketi KAPATIYOR; sonrasında işlem PACKAGE_EXPIRED")
    fun fullRefundClosesPackage() =
        runTest {
            val before = ayse()

            val result =
                service.refund(before.id, before.version, RefundPackageInput(null, "Tam iade talebi"), "iade-2")
            val after = ayse()

            assertEquals(7, result.refundedSessions)
            assertEquals(0, after.remainingSessions)
            assertEquals(CustomerPackageStatus.Refunded, after.status)
            val code =
                codeOf { adjust(after, change(laser to 1)) }
            assertEquals(ApiErrorCode.PACKAGE_EXPIRED, code)
            assertLedgerMatches(before.id)
        }

    @Test
    @DisplayName("Kalandan fazla iade PACKAGE_EXHAUSTED; aynı anahtarla tekrar İKİNCİ kez iade etmiyor")
    fun refundGuards() =
        runTest {
            val before = ayse()
            val tooMuch =
                codeOf {
                    val input = RefundPackageInput(sessions(skin, 2), "Fazla iade")
                    service.refund(before.id, before.version, input, "iade-3")
                }
            assertEquals(ApiErrorCode.PACKAGE_EXHAUSTED, tooMuch)
            assertEquals(7, ayse().remainingSessions)

            val input = RefundPackageInput(listOf(SessionsItemInput(laser, 1)), "Tek seans iadesi")
            val first = service.refund(before.id, before.version, input, "iade-4")
            val second = service.refund(before.id, before.version, input, "iade-4")

            assertEquals(first, second)
            assertEquals(6, ayse().remainingSessions, "Tekrar ikinci bir iade yazmadı")
            assertLedgerMatches(before.id)
        }

    @Test
    @DisplayName("Devir hakkı TAŞIYOR: iki tarafın toplamı korunuyor, geçerlilik sonu aynı")
    fun transferPreservesTotal() =
        runTest {
            val before = ayse()
            val input = TransferPackageInput(zeynep, listOf(SessionsItemInput(laser, 3)), "Kız kardeşine devir")

            val target = service.transfer(before.id, before.version, input, "devir-1")
            val source = ayse()

            assertEquals(before.remainingSessions, source.remainingSessions + target.remainingSessions)
            assertEquals(zeynep, target.customerId)
            assertEquals(before.id, target.transferredFromPackageId)
            assertEquals(before.expiresAt, target.expiresAt)
            assertEquals(LedgerEntryType.TransferIn, service.ledger(target.id).data.single().entryType)
            assertEquals(LedgerEntryType.TransferOut, service.ledger(source.id).data.first().entryType)
            // Karşılık kaynağın tahsisinden taşınır: 111.196 × 3.
            assertEquals(333_588L, target.outstandingMinor)
            assertLedgerMatches(source.id)
            assertLedgerMatches(target.id)
        }

    @Test
    @DisplayName("Tüm hakkı devretmek kaynağı 'Devredildi' yapıyor")
    fun wholeTransferClosesSource() =
        runTest {
            val before = ayse()

            service.transfer(before.id, before.version, TransferPackageInput(zeynep, null, "Tamamen devir"), "devir-2")

            assertEquals(CustomerPackageStatus.Transferred, ayse().status)
            assertEquals(0, ayse().remainingSessions)
        }

    @Test
    @DisplayName("Devredilemez paket CONFLICT, aynı müşteriye devir ve kısa gerekçe 400")
    fun transferGuards() =
        runTest {
            val sold =
                service.sell(
                    CreateCustomerPackageInput(MockPackagesSeed.AYSE_ID, MockPackagesSeed.DEFINITION_SKIN_CARE_5),
                    "s",
                )
            val ayse = ayse()

            suspend fun transfer(
                pkg: CustomerPackage,
                input: TransferPackageInput,
            ) = codeOf { service.transfer(pkg.id, pkg.version, input, "d-${input.reason}") }

            val notTransferable = transfer(sold, TransferPackageInput(zeynep, null, "Devir denemesi"))
            val sameCustomer = transfer(ayse, TransferPackageInput(ayse.customerId, null, "Kendine devir"))
            val shortReason = transfer(ayse, TransferPackageInput(zeynep, null, "kısa"))

            assertEquals(ApiErrorCode.CONFLICT, notTransferable)
            assertEquals(ApiErrorCode.VALIDATION_FAILED, sameCustomer)
            assertEquals(ApiErrorCode.VALIDATION_FAILED, shortReason)
            assertEquals(7, ayse().remainingSessions)
        }

    @Test
    @DisplayName("Gövdeler: tam iade `items` göndermiyor, gerekçe kırpılıyor, sıfır delta geçersiz")
    fun bodies() {
        assertFalse(RefundPackageInput(null, "  Gerekçe  ").toJson().containsKey("items"))
        assertEquals("\"Gerekçe\"", RefundPackageInput(null, "  Gerekçe  ").toJson()["reason"].toString())
        assertFalse(AdjustPackageInput(listOf(AdjustItemInput(laser, 0)), "Gerekçe var").isValid)
        assertFalse(AdjustPackageInput(listOf(AdjustItemInput(laser, 1)), "abc").isValid)
        assertTrue(AdjustPackageInput(listOf(AdjustItemInput(laser, -1)), "Yeterli gerekçe").isValid)
    }
}
