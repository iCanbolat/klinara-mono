package com.klinara.android.features.customers

import com.klinara.android.services.crm.CreateCustomerInput
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerListQuery
import com.klinara.android.services.crm.CustomerService
import com.klinara.android.services.crm.MockCustomerService
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.crm.UpdateCustomerInput
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
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CustomerEditorViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    @Test
    @DisplayName("Yeni müşteri: etiket seçilmediyse İKİNCİ istek atılmaz")
    fun creatingWithoutTagsIssuesOneRequest() =
        runTest {
            val counting = CountingWrites(MockCustomerService(latencyEnabled = false))
            val viewModel = CustomerEditorViewModel(counting, customerId = null)
            viewModel.load()
            advanceUntilIdle()

            viewModel.update { it.copy(fullName = "Yeni Müşteri") }
            viewModel.save()
            advanceUntilIdle()

            assertEquals(1, counting.createCalls)
            // Etiket ucu gereksiz yere çağrılırsa her yeni kayıt iki istek eder.
            assertEquals(0, counting.replaceTagCalls)
            assertNotNull(viewModel.state.value.savedCustomer)
        }

    @Test
    @DisplayName("Yeni müşteri: etiket seçildiyse SIRAYLA iki istek — önce kayıt, sonra etiket")
    fun creatingWithTagsIssuesTwoRequests() =
        runTest {
            val counting = CountingWrites(MockCustomerService(latencyEnabled = false))
            val viewModel = CustomerEditorViewModel(counting, customerId = null)
            viewModel.load()
            advanceUntilIdle()

            val tagId = viewModel.state.value.tags.valueOrNull!!.first().id
            viewModel.update { it.copy(fullName = "Etiketli").toggleTag(tagId) }
            viewModel.save()
            advanceUntilIdle()

            // Etiket ucu var olan bir kimlik ister; sıra sunucunun dayattığı bir kural.
            assertEquals(1, counting.createCalls)
            assertEquals(1, counting.replaceTagCalls)
            assertEquals(listOf(tagId), viewModel.state.value.savedCustomer?.tags?.map { it.id })
        }

    @Test
    @DisplayName("Düzenleme: hiçbir şey değişmediyse PATCH atılmaz")
    fun untouchedEditIssuesNoPatch() =
        runTest {
            val mock = MockCustomerService(latencyEnabled = false)
            val existing = mock.list(CustomerListQuery(limit = 1)).data.first()
            val counting = CountingWrites(mock)
            val viewModel = CustomerEditorViewModel(counting, customerId = existing.id)
            viewModel.load()
            advanceUntilIdle()

            viewModel.save()
            advanceUntilIdle()

            // Boş bir PATCH sunucuya gereksiz bir yazma ve kayda gereksiz bir
            // `updatedAt` demek.
            assertEquals(0, counting.updateCalls)
            assertNotNull(viewModel.state.value.savedCustomer)
        }

    @Test
    @DisplayName("Düzenleme: yalnız etiket değiştiyse PATCH yok, etiket isteği var")
    fun tagOnlyEditSkipsThePatch() =
        runTest {
            val mock = MockCustomerService(latencyEnabled = false)
            val existing = mock.list(CustomerListQuery(limit = 100)).data.first { it.tags.isEmpty() }
            val counting = CountingWrites(mock)
            val viewModel = CustomerEditorViewModel(counting, customerId = existing.id)
            viewModel.load()
            advanceUntilIdle()

            val tagId = viewModel.state.value.tags.valueOrNull!!.first().id
            viewModel.update { it.toggleTag(tagId) }
            viewModel.save()
            advanceUntilIdle()

            assertEquals(0, counting.updateCalls)
            assertEquals(1, counting.replaceTagCalls)
        }

    @Test
    @DisplayName("Alan hatası ilgili alana düşer, tepede afiş ÇIKMAZ")
    fun fieldErrorsDoNotRaiseABanner() =
        runTest {
            val mock = MockCustomerService(latencyEnabled = false)
            val viewModel = CustomerEditorViewModel(mock, customerId = null)
            viewModel.load()
            advanceUntilIdle()

            // Yarım telefon: mock sunucu gibi alan hatası veriyor.
            viewModel.update { it.copy(fullName = "Test", phoneE164 = "+90532") }
            viewModel.save()
            advanceUntilIdle()

            val state = viewModel.state.value
            assertEquals("Telefon numarası 10 haneli olmalı", state.fieldErrors["phone"])
            // Aynı şeyi iki yerde söylemek gürültüdür.
            assertNull(state.error)
            assertNull(state.savedCustomer)
        }

    @Test
    @DisplayName("Form düzenlenince eski hata TEMİZLENİR")
    fun editingClearsStaleErrors() =
        runTest {
            val viewModel = CustomerEditorViewModel(MockCustomerService(latencyEnabled = false), customerId = null)
            viewModel.load()
            advanceUntilIdle()
            viewModel.update { it.copy(fullName = "Test", phoneE164 = "+90532") }
            viewModel.save()
            advanceUntilIdle()
            assertTrue(viewModel.state.value.fieldErrors.isNotEmpty())

            viewModel.update { it.copy(phoneE164 = "+905329998877") }

            assertTrue(viewModel.state.value.fieldErrors.isEmpty())
        }

    @Test
    @DisplayName("Geçersiz form kaydedilmez — istek hiç atılmaz")
    fun invalidFormDoesNotSave() =
        runTest {
            val counting = CountingWrites(MockCustomerService(latencyEnabled = false))
            val viewModel = CustomerEditorViewModel(counting, customerId = null)
            viewModel.load()
            advanceUntilIdle()

            viewModel.save()
            advanceUntilIdle()

            assertEquals(0, counting.createCalls)
        }
}

/** Yazma çağrılarını sayan sarmalayıcı; kuralları gerçek mock uyguluyor. */
private class CountingWrites(
    private val delegate: CustomerService,
) : CustomerService by delegate {
    var createCalls = 0
        private set
    var updateCalls = 0
        private set
    var replaceTagCalls = 0
        private set

    override suspend fun create(input: CreateCustomerInput): Customer {
        createCalls += 1
        return delegate.create(input)
    }

    override suspend fun update(
        id: String,
        input: UpdateCustomerInput,
    ): Customer {
        updateCalls += 1
        return delegate.update(id, input)
    }

    override suspend fun replaceTags(
        customerId: String,
        tagIds: List<String>,
    ): Customer {
        replaceTagCalls += 1
        return delegate.replaceTags(customerId, tagIds)
    }
}
