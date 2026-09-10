package com.klinara.android.features.customers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerService
import com.klinara.android.services.crm.CustomerTag
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CustomerEditorUiState(
    val form: CustomerForm = CustomerForm.empty(),
    /** Düzenlemede kayıt yüklenene kadar form çizilmez; oluşturmada `Loaded(null)`. */
    val loaded: Loadable<Customer?> = Loadable.Loading,
    val tags: Loadable<List<CustomerTag>> = Loadable.Loading,
    val isSaving: Boolean = false,
    val error: String? = null,
    /** Sunucudan gelen alan bazlı hatalar — `FieldError.path` → mesaj. */
    val fieldErrors: Map<String, String> = emptyMap(),
    val savedCustomer: Customer? = null,
)

/**
 * Müşteri oluşturma ve düzenleme.
 *
 * **Tek ekran, iki mod.** Ayırmak aynı formu iki kez yazmak olurdu; değişen yalnız
 * başlangıç değerleri, düğme metni ve hangi ucun çağrıldığı ([customerId] null mı).
 * `BookingFlowScreen`'in oluşturma/erteleme kararının aynısı.
 *
 * **Kayıt İKİ istektir** ve bu sunucunun dayattığı bir sıra: etiket ucu (`PUT
 * customers/:id/tags`) var olan bir kimlik ister, dolayısıyla yeni müşteride önce kayıt
 * doğmalı. İkinci istek yalnız etiketler değiştiyse atılır.
 */
class CustomerEditorViewModel(
    private val customers: CustomerService,
    private val customerId: String?,
) : ViewModel() {
    private val _state = MutableStateFlow(CustomerEditorUiState())
    val state: StateFlow<CustomerEditorUiState> = _state.asStateFlow()

    val isNew: Boolean get() = customerId == null

    fun load() {
        loadTags()

        if (customerId == null) {
            _state.update { it.copy(loaded = Loadable.Loaded(null), form = CustomerForm.empty()) }
            return
        }

        _state.update { it.copy(loaded = Loadable.Loading) }
        viewModelScope.launch {
            when (val result = Loadable.of { customers.get(customerId) }) {
                is Loadable.Loaded ->
                    _state.update {
                        it.copy(loaded = Loadable.Loaded(result.value), form = CustomerForm.of(result.value))
                    }
                is Loadable.Failed -> _state.update { it.copy(loaded = result) }
                Loadable.Loading -> Unit
            }
        }
    }

    private fun loadTags() {
        if (_state.value.tags is Loadable.Loaded) return
        viewModelScope.launch {
            _state.update { it.copy(tags = Loadable.of { customers.tags() }) }
        }
    }

    /** Form değişikliği yazma hatasını da temizler: kullanıcı düzeltirken eski hata durmamalı. */
    fun update(transform: (CustomerForm) -> CustomerForm) =
        _state.update { it.copy(form = transform(it.form), error = null, fieldErrors = emptyMap()) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun save() {
        val current = _state.value
        if (current.isSaving || !current.form.isValid) return

        _state.update { it.copy(isSaving = true, error = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                val form = current.form
                val saved =
                    if (customerId == null) {
                        customers.create(form.createInput())
                    } else {
                        val input = form.updateInput()
                        // Boş bir PATCH göndermek sunucuya gereksiz bir yazma ve kayda
                        // gereksiz bir `updatedAt` demek.
                        if (input.isEmpty) customers.get(customerId) else customers.update(customerId, input)
                    }

                // İkinci istek: etiketler. Yeni kayıtta ancak seçim varsa gerekir.
                val withTags =
                    if (form.tagsChanged || (customerId == null && form.tagIds.isNotEmpty())) {
                        customers.replaceTags(saved.id, form.tagIds.toList())
                    } else {
                        saved
                    }

                _state.update { it.copy(isSaving = false, savedCustomer = withTags) }
            } catch (error: ApiError) {
                _state.update {
                    it.copy(
                        isSaving = false,
                        // Alan hatası varsa afiş YAZILMAZ: mesaj zaten ilgili alanın
                        // altında ve iki yerde aynı şeyi söylemek gürültüdür.
                        error = if (error.isFieldScoped) null else error.displayMessage,
                        fieldErrors = error.fieldErrors,
                    )
                }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            customerId: String?,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    CustomerEditorViewModel(container.customers, customerId) as T
            }
    }
}
