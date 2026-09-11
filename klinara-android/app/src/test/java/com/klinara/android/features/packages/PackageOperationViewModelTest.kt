package com.klinara.android.features.packages

import com.klinara.android.services.crm.MockCustomerService
import com.klinara.android.services.packages.AdjustItemInput
import com.klinara.android.services.packages.AdjustPackageInput
import com.klinara.android.services.packages.MockPackagesSeed
import com.klinara.android.services.packages.MockPackagesService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PackageOperationViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    private val service = MockPackagesService(latencyEnabled = false)

    private fun subject() =
        PackageOperationViewModel(
            service,
            MockCustomerService(latencyEnabled = false),
            MockPackagesSeed.SOLD_AYSE_PACKAGE,
        )

    @Test
    @DisplayName("Başkası araya girince: VERSION_CONFLICT, paket TAZELENİYOR, form yerinde kalıyor")
    fun versionConflictRefreshesAndKeepsForm() =
        runTest {
            val viewModel = subject()
            viewModel.load()
            advanceUntilIdle()
            val opened = viewModel.state.value.pkg.valueOrNull!!
            // Başka bir oturum aynı paketi düzeltiyor.
            service.adjust(
                opened.id,
                opened.version,
                AdjustPackageInput(listOf(AdjustItemInput(MockPackagesSeed.SOLD_AYSE_ITEM_LASER, 1)), "Başka oturum"),
            )

            viewModel.setAmount(MockPackagesSeed.SOLD_AYSE_ITEM_LASER, -1)
            viewModel.setReason("Kayıt dışı seans")
            viewModel.submit(PackageOperation.Adjust)
            advanceUntilIdle()

            val state = viewModel.state.value
            assertNotNull(state.error)
            assertFalse(state.isDone)
            assertEquals(opened.version + 1, state.pkg.valueOrNull?.version, "Sonraki deneme taze sürümle gitsin")
            assertEquals(-1, state.amounts[MockPackagesSeed.SOLD_AYSE_ITEM_LASER])
            assertTrue(state.canSubmit(PackageOperation.Adjust))
        }

    @Test
    @DisplayName("İade tahmini satış tahsisinden; tam iade tüm kalanı sayıyor")
    fun refundEstimate() =
        runTest {
            val viewModel = subject()
            viewModel.load()
            advanceUntilIdle()

            // Tam: lazer 6 × 111.196 + bakım 1 × 69.018.
            assertEquals(6 * 111_196L + 69_018L, viewModel.state.value.estimatedRefundMinor)
            viewModel.setWhole(false)
            viewModel.setAmount(MockPackagesSeed.SOLD_AYSE_ITEM_SKIN, 1)
            assertEquals(69_018L, viewModel.state.value.estimatedRefundMinor)
        }
}
