package com.klinara.android.features.customers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerService
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CustomerDetailUiState(
    val customer: Loadable<Customer> = Loadable.Loading,
    val isArchiving: Boolean = false,
    val askArchive: Boolean = false,
    val error: String? = null,
    /** Arşivleme bittiğinde ekran kapanmalı; karar çağıranın. */
    val archived: Boolean = false,
)

/**
 * Müşteri kartı.
 *
 * **Kart kendi verisini ÇEKER**, listeden devralmaz. Alternatif, `CustomerListViewModel`
 * ın önbelleğinden okumaktı; o da bir ekranın gerçeğini başka bir ekranın hafızasına
 * bağlar ve listeye hiç uğramadan (derin bağlantı, randevu detayından geçiş) açılan bir
 * kartı boş bırakırdı. A3.3'te `CustomerService.get` tam bu gerekçeyle doğmuştu.
 *
 * **Kartla doğar, kartla ölür.** Not ve fotoğraf (A4.3/A4.4) buraya eklenecek; onları
 * liste ViewModel'ine koymak, açılmış her müşterinin sağlık verisini oturum boyunca
 * bellekte tutmak olurdu.
 */
class CustomerDetailViewModel(
    private val customers: CustomerService,
    private val customerId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(CustomerDetailUiState())
    val state: StateFlow<CustomerDetailUiState> = _state.asStateFlow()

    fun load() {
        _state.update { it.copy(customer = Loadable.Loading) }
        viewModelScope.launch {
            _state.update { it.copy(customer = Loadable.of { customers.get(customerId) }) }
        }
    }

    fun askArchive() = _state.update { it.copy(askArchive = true) }

    fun cancelArchive() = _state.update { it.copy(askArchive = false) }

    fun dismissError() = _state.update { it.copy(error = null) }

    /**
     * Arşivler — **silmez**.
     *
     * Yazma hatası okunan kaydı DÜŞÜRMEZ, yalnız afiş gösterir: arşivleme denemesinin
     * başarısız olması, kullanıcının baktığı kartı ekrandan silmek için sebep değil.
     */
    fun archive() {
        if (_state.value.isArchiving) return
        _state.update { it.copy(askArchive = false, isArchiving = true, error = null) }
        viewModelScope.launch {
            try {
                customers.archive(customerId)
                _state.update { it.copy(isArchiving = false, archived = true) }
            } catch (error: ApiError) {
                _state.update { it.copy(isArchiving = false, error = error.displayMessage) }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            customerId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    CustomerDetailViewModel(container.customers, customerId) as T
            }
    }
}
