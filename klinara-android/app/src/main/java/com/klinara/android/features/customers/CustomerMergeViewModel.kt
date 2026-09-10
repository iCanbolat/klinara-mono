package com.klinara.android.features.customers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerMergeResult
import com.klinara.android.services.crm.CustomerService
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CustomerMergeUiState(
    val target: Loadable<Customer> = Loadable.Loading,
    val term: String = "",
    val results: Loadable<List<Customer>>? = null,
    /** Onay bekleyen kaynak kayıt — iki adımlı onayın birinci adımı. */
    val pending: Customer? = null,
    val isMerging: Boolean = false,
    val error: String? = null,
    val result: CustomerMergeResult? = null,
)

/**
 * Mükerrer kayıt birleştirme.
 *
 * **Kendi arama durumunu tutar**, `CustomerListViewModel`inkini kullanmaz: onu ezmek,
 * bu ekran kapandığında arkadaki listenin bambaşka bir yerde durması demekti.
 *
 * **Geri alınması pahalı bir işlem** (`customer:merge` ayrı bir izin olmasının sebebi
 * bu), o yüzden iki adımlı: önce kaynak seçilir, sonra ayrıca onaylanır.
 */
class CustomerMergeViewModel(
    private val customers: CustomerService,
    private val targetCustomerId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(CustomerMergeUiState())
    val state: StateFlow<CustomerMergeUiState> = _state.asStateFlow()

    private var searchJob: Job? = null

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(target = Loadable.of { customers.get(targetCustomerId) }) }
        }
    }

    fun search(term: String) {
        val trimmed = term.trim()
        if (trimmed == _state.value.term) return

        searchJob?.cancel()
        _state.update { it.copy(term = trimmed) }

        if (trimmed.length < MIN_SEARCH_LENGTH) {
            _state.update { it.copy(results = null) }
            return
        }

        _state.update { it.copy(results = Loadable.Loading) }
        searchJob =
            viewModelScope.launch {
                delay(SEARCH_DEBOUNCE_MILLIS)
                val found =
                    Loadable.of {
                        // Hedefin kendisi aday olamaz: sunucu kendine birleştirmeyi
                        // 400 ile reddediyor ve seçilebilir göstermek kullanıcıyı
                        // reddedilecek bir yola davet etmek olurdu.
                        customers.search(trimmed).filterNot { it.id == targetCustomerId }
                    }
                if (_state.value.term == trimmed) _state.update { it.copy(results = found) }
            }
    }

    fun askMerge(source: Customer) = _state.update { it.copy(pending = source) }

    fun cancelMerge() = _state.update { it.copy(pending = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun confirmMerge() {
        val source = _state.value.pending ?: return
        _state.update { it.copy(pending = null, isMerging = true, error = null) }

        viewModelScope.launch {
            try {
                val merged = customers.merge(targetCustomerId, source.id)
                _state.update {
                    it.copy(
                        isMerging = false,
                        result = merged,
                        target = Loadable.Loaded(merged.customer),
                        // Sonuçlar artık bayat: kaynak kayıt arşivlendi.
                        results = null,
                        term = "",
                    )
                }
            } catch (error: ApiError) {
                _state.update { it.copy(isMerging = false, error = error.displayMessage) }
            }
        }
    }

    companion object {
        private const val MIN_SEARCH_LENGTH = 2
        private const val SEARCH_DEBOUNCE_MILLIS = 250L

        fun factory(
            container: ServiceContainer,
            targetCustomerId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    CustomerMergeViewModel(container.customers, targetCustomerId) as T
            }
    }
}
