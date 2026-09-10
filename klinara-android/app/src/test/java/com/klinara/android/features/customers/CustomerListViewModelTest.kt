package com.klinara.android.features.customers

import com.klinara.android.services.crm.CreateCustomerInput
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerListQuery
import com.klinara.android.services.crm.CustomerService
import com.klinara.android.services.crm.MockCustomerService
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.crm.UpdateCustomerInput
import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.networking.Page
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
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CustomerListViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    private fun subject(service: CustomerService = MockCustomerService(latencyEnabled = false)) =
        CustomerListViewModel(service)

    @Test
    @DisplayName("Liste yükleniyor ve ilk sayfa geliyor")
    fun loadsFirstPage() =
        runTest {
            val viewModel = subject()
            viewModel.load()
            advanceUntilIdle()

            assertTrue(viewModel.state.value.list is Loadable.Loaded)
            assertTrue(viewModel.state.value.visible.valueOrNull!!.isNotEmpty())
        }

    @Test
    @DisplayName("`loadMore` sayfayı EKLER, listeyi değiştirmez")
    fun loadMoreAppends() =
        runTest {
            val counting = CountingCustomers(MockCustomerService(latencyEnabled = false), pageLimit = 3)
            val viewModel = subject(counting)
            viewModel.load()
            advanceUntilIdle()
            val first = viewModel.state.value.visible.valueOrNull!!

            viewModel.loadMore()
            advanceUntilIdle()
            val second = viewModel.state.value.visible.valueOrNull!!

            assertTrue(second.size > first.size)
            // Eklenen sayfa öncekini EZMEMELİ: ilk sayfa hâlâ başta.
            assertEquals(first.map { it.id }, second.take(first.size).map { it.id })
            assertEquals(second.size, second.map { it.id }.toSet().size)
        }

    @Test
    @DisplayName("İki karakterden kısa terim İSTEK ÜRETMEZ ve arama modundan çıkar")
    fun shortTermIssuesNoRequest() =
        runTest {
            val counting = CountingCustomers(MockCustomerService(latencyEnabled = false))
            val viewModel = subject(counting)

            viewModel.search("a")
            advanceUntilIdle()

            // Sunucu `q >= 2` istiyor; kısa terimle çağırmak 400 karşılığında hiçbir
            // şey öğrenmemek olurdu.
            assertEquals(0, counting.searchCalls)
            assertNull(viewModel.state.value.search)
            assertFalse(viewModel.state.value.isSearching)
        }

    @Test
    @DisplayName("Hızlı yazım TEK istek üretir — debounce çalışıyor")
    fun debounceCollapsesKeystrokes() =
        runTest {
            val counting = CountingCustomers(MockCustomerService(latencyEnabled = false))
            val viewModel = subject(counting)

            // "Yıl" yazan bir kullanıcı üç tuşa basar; üç istek atmak sunucuya
            // saniyede beş sorgu bindirmek olurdu.
            viewModel.search("Yı")
            viewModel.search("Yıl")
            viewModel.search("Yılm")
            advanceUntilIdle()

            assertEquals(1, counting.searchCalls)
            assertEquals("Yılm", counting.lastTerm)
        }

    @Test
    @DisplayName("Arama sonucu listeyi GİZLER ama silmez; temizleyince liste geri gelir")
    fun searchMasksTheListWithoutDestroyingIt() =
        runTest {
            val viewModel = subject()
            viewModel.load()
            advanceUntilIdle()
            val browsing = viewModel.state.value.visible.valueOrNull!!

            viewModel.search("Yılmaz")
            advanceUntilIdle()
            assertTrue(viewModel.state.value.isSearching)
            assertTrue(viewModel.state.value.visible.valueOrNull!!.size < browsing.size)

            viewModel.clearSearch()
            // Liste yeniden çekilmiyor: arama onu hiç düşürmemişti.
            assertEquals(browsing.map { it.id }, viewModel.state.value.visible.valueOrNull!!.map { it.id })
        }

    @Test
    @DisplayName("Arama sırasında sayfalama KAPALI — arama ucu sayfalanmıyor")
    fun noPaginationWhileSearching() =
        runTest {
            val viewModel = subject(CountingCustomers(MockCustomerService(latencyEnabled = false), pageLimit = 3))
            viewModel.load()
            advanceUntilIdle()
            assertTrue(viewModel.state.value.canLoadMore)

            viewModel.search("Yılmaz")
            advanceUntilIdle()

            assertFalse(viewModel.state.value.canLoadMore)
        }

    @Test
    @DisplayName("Sayfa hatası yüklenmiş listeyi DÜŞÜRMEZ")
    fun failedPageKeepsTheList() =
        runTest {
            val flaky = MockCustomerService(latencyEnabled = false)
            val counting = CountingCustomers(flaky, pageLimit = 3)
            val viewModel = subject(counting)
            viewModel.load()
            advanceUntilIdle()
            val loaded = viewModel.state.value.visible.valueOrNull!!

            flaky.failing = true
            viewModel.loadMore()
            advanceUntilIdle()

            // Yüklenmiş kayıtları bir sayfa hatası yüzünden silmek, kullanıcıyı
            // en başa döndürmek olurdu.
            assertEquals(loaded.map { it.id }, viewModel.state.value.visible.valueOrNull!!.map { it.id })
            assertFalse(viewModel.state.value.isLoadingMore)
        }

    @Test
    @DisplayName("Bilinen bir müşteri aranınca bulunuyor (Türkçe katlama uçtan uca)")
    fun searchFindsTheSeededCustomer() =
        runTest {
            val viewModel = subject()

            viewModel.search("YILMAZ")
            advanceUntilIdle()

            val results = viewModel.state.value.search?.valueOrNull.orEmpty()
            assertTrue(results.any { it.fullName == MockCustomers.ALL.first().fullName })
        }
}

/**
 * Çağrı sayan sarmalayıcı — gerçek mock'u delege eder.
 *
 * Elle yazılmış bir sahte, mock'un kurallarını (imleç, katlama) ikinci kez ve biraz
 * farklı uygulamak olurdu; sayaç için davranışı yeniden yazmıyoruz.
 */
private class CountingCustomers(
    private val delegate: CustomerService,
    private val pageLimit: Int? = null,
) : CustomerService {
    var searchCalls: Int = 0
        private set
    var lastTerm: String? = null
        private set

    override suspend fun list(query: CustomerListQuery): Page<Customer> =
        delegate.list(if (pageLimit != null) query.copy(limit = pageLimit) else query)

    override suspend fun get(id: String): Customer = delegate.get(id)

    override suspend fun search(
        query: String,
        limit: Int?,
    ): List<Customer> {
        searchCalls += 1
        lastTerm = query
        return delegate.search(query, limit)
    }

    // Yazma yarısı bu testin konusu değil; olduğu gibi delege ediliyor.
    override suspend fun create(input: CreateCustomerInput) = delegate.create(input)

    override suspend fun update(
        id: String,
        input: UpdateCustomerInput,
    ) = delegate.update(id, input)

    override suspend fun archive(id: String) = delegate.archive(id)

    override suspend fun replaceTags(
        customerId: String,
        tagIds: List<String>,
    ) = delegate.replaceTags(customerId, tagIds)

    override suspend fun tags() = delegate.tags()

    override suspend fun createTag(
        name: String,
        color: String?,
    ) = delegate.createTag(name, color)

    override suspend fun updateTag(
        id: String,
        name: String?,
        color: Patch<String>,
    ) = delegate.updateTag(id, name, color)

    override suspend fun deleteTag(id: String) = delegate.deleteTag(id)

    override suspend fun merge(
        targetCustomerId: String,
        sourceCustomerId: String,
    ) = delegate.merge(targetCustomerId, sourceCustomerId)
}
