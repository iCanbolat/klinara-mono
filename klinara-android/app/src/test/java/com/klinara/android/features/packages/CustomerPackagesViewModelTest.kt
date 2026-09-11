package com.klinara.android.features.packages

import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.CreateCustomerPackageInput
import com.klinara.android.services.packages.CustomerPackage
import com.klinara.android.services.packages.MockPackagesSeed
import com.klinara.android.services.packages.MockPackagesService
import com.klinara.android.services.packages.PackagesService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CustomerPackagesViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    @Test
    @DisplayName("Açık paketler önce; toplam hak yalnız AÇIK paketlerden ve sunucunun sayısından")
    fun orderingAndTotal() =
        runTest {
            val service = MockPackagesService(latencyEnabled = false)
            // Kalanı sıfır olan yeni bir paket: satılır ve tamamı iade edilmiş gibi değil,
            // kapalı bir durum yerine kalanı olan ikinci açık paket olarak kalır.
            val input = CreateCustomerPackageInput(MockPackagesSeed.AYSE_ID, MockPackagesSeed.DEFINITION_SKIN_CARE_5)
            service.sell(input, "k")
            val viewModel = CustomerPackagesViewModel(service, MockPackagesSeed.AYSE_ID)

            viewModel.load()
            advanceUntilIdle()

            val state = viewModel.state.value
            assertEquals(2, state.ordered.size)
            // Yeni satış üstte (ikisi de açık).
            assertEquals(MockPackagesSeed.DEFINITION_SKIN_CARE_5, state.ordered.first().definitionId)
            assertEquals(7 + 5, state.totalRemainingSessions)
        }

    @Test
    @DisplayName("Tazeleme hatası eldeki listeyi SİLMİYOR — karta dönüşte bölüm boşalmaz")
    fun refreshFailureKeepsList() =
        runTest {
            val service = MockPackagesService(latencyEnabled = false)
            val viewModel = CustomerPackagesViewModel(service, MockPackagesSeed.AYSE_ID)
            viewModel.load()
            advanceUntilIdle()

            service.failing = true
            viewModel.load()
            advanceUntilIdle()

            assertTrue(viewModel.state.value.packages is Loadable.Loaded)
        }

    @Test
    @DisplayName("Satış yanıtı kaybolup TEKRAR basılınca aynı anahtar gidiyor — tek paket")
    fun sellRetryAfterLostResponseDoesNotDuplicate() =
        runTest {
            val inner = MockPackagesService(latencyEnabled = false)
            val keys = mutableListOf<String>()
            // Sunucu satışı YAZIYOR ama yanıt yolda kayboluyor — tekrarın gerçek senaryosu.
            val lossy =
                object : PackagesService by inner {
                    var dropNext = true

                    override suspend fun sell(
                        input: CreateCustomerPackageInput,
                        idempotencyKey: String,
                    ): CustomerPackage {
                        keys += idempotencyKey
                        val sold = inner.sell(input, idempotencyKey)
                        if (dropNext) {
                            dropNext = false
                            throw ApiError.Network()
                        }
                        return sold
                    }
                }
            val viewModel = SellPackageViewModel(lossy, MockPackagesSeed.AYSE_ID, MockIds.BRANCH_NISANTASI)
            viewModel.load()
            advanceUntilIdle()
            viewModel.select(MockPackagesSeed.DEFINITION_LASER_10)

            viewModel.sell()
            advanceUntilIdle()
            viewModel.sell()
            advanceUntilIdle()

            assertEquals(1, keys.toSet().size, "İki deneme, TEK anahtar")
            assertEquals(2, inner.packages(MockPackagesSeed.AYSE_ID).data.size, "Seed + tek satış")
            assertTrue(viewModel.state.value.sold != null)
        }

    @Test
    @DisplayName("Satış sayfası yalnız bu şubede SATILABİLİR tanımları listeliyor")
    fun sellOptionsAreScopedToBranch() =
        runTest {
            val viewModel =
                SellPackageViewModel(
                    MockPackagesService(latencyEnabled = false),
                    MockPackagesSeed.AYSE_ID,
                    MockIds.BRANCH_BODRUM,
                )

            viewModel.load()
            advanceUntilIdle()

            val ids = viewModel.state.value.options.valueOrNull?.map { it.id }
            assertEquals(listOf(MockPackagesSeed.DEFINITION_LASER_10), ids)
        }
}
