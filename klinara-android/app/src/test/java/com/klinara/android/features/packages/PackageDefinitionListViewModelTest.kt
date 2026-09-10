package com.klinara.android.features.packages

import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.Page
import com.klinara.android.services.packages.MockPackagesSeed
import com.klinara.android.services.packages.MockPackagesService
import com.klinara.android.services.packages.PackageDefinition
import com.klinara.android.services.packages.PackageDefinitionQuery
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
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PackageDefinitionListViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    /** Sorguları sayan sarmalayıcı — "yeniden çekti mi" sorusunun tek dürüst cevabı. */
    private class Counting(
        private val inner: PackagesService = MockPackagesService(latencyEnabled = false),
    ) : PackagesService by inner {
        val queries = mutableListOf<PackageDefinitionQuery>()

        override suspend fun definitions(query: PackageDefinitionQuery): Page<PackageDefinition> {
            queries += query
            return inner.definitions(query)
        }
    }

    @Test
    @DisplayName("Kapsam değişimi listeyi SUNUCUDAN yeniden çekiyor, istemcide süzmüyor")
    fun scopeChangeRefetches() =
        runTest {
            val service = Counting()
            val viewModel = PackageDefinitionListViewModel(service)

            viewModel.ensureScope(null)
            advanceUntilIdle()
            viewModel.ensureScope(MockIds.BRANCH_BODRUM)
            advanceUntilIdle()

            assertEquals(listOf(null, MockIds.BRANCH_BODRUM), service.queries.map { it.branchId })
            val ids = viewModel.state.value.definitions.valueOrNull?.map { it.id }
            assertEquals(listOf(MockPackagesSeed.DEFINITION_LASER_10), ids)
        }

    @Test
    @DisplayName("Aynı kapsam listeyi 'yükleniyor'a DÜŞÜRMEDEN sessizce tazeliyor")
    fun sameScopeRefreshesSilently() =
        runTest {
            val service = Counting()
            val viewModel = PackageDefinitionListViewModel(service)
            viewModel.ensureScope(null)
            advanceUntilIdle()

            viewModel.ensureScope(null)

            // Tazeleme yolda ama eldeki liste yerinde duruyor — ekran titremiyor.
            assertTrue(viewModel.state.value.definitions.valueOrNull?.isNotEmpty() == true)
            advanceUntilIdle()
            assertEquals(2, service.queries.size)
        }

    @Test
    @DisplayName("Satılabilir liste pasifleri ve BAŞKA şubenin paketlerini eliyor")
    fun sellableFiltersInactiveAndOtherBranches() =
        runTest {
            val service = MockPackagesService(latencyEnabled = false)
            val laser = service.definition(MockPackagesSeed.DEFINITION_LASER_10)
            service.retireDefinition(laser.id, laser.version)
            val viewModel = PackageDefinitionListViewModel(service)

            viewModel.ensureScope(null)
            advanceUntilIdle()

            val state = viewModel.state.value
            assertTrue(state.sellable(MockIds.BRANCH_BODRUM).isEmpty(), "Bodrum'da ne pasif lazer ne Nişantaşı paketi")
            val nisantasi = state.sellable(MockIds.BRANCH_NISANTASI).map { it.id }
            assertEquals(listOf(MockPackagesSeed.DEFINITION_SKIN_CARE_5), nisantasi)
        }

    @Test
    @DisplayName("Satılmış tanımı emekliye ayırmak onu listeden DÜŞÜRMÜYOR, pasif gösteriyor")
    fun retireKeepsSoldDefinitionAsInactive() =
        runTest {
            val viewModel = PackageDefinitionListViewModel(MockPackagesService(latencyEnabled = false))
            viewModel.ensureScope(null)
            advanceUntilIdle()
            val laser =
                viewModel.state.value.definitions.valueOrNull!!
                    .first { it.id == MockPackagesSeed.DEFINITION_LASER_10 }

            viewModel.askRetire(laser)
            viewModel.confirmRetire()
            advanceUntilIdle()

            val after = viewModel.state.value.definitions.valueOrNull!!.first { it.id == laser.id }
            assertFalse(after.isActive)
            assertFalse(viewModel.state.value.isSaving)
        }
}
