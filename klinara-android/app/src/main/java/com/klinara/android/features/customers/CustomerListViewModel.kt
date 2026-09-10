package com.klinara.android.features.customers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerListQuery
import com.klinara.android.services.crm.CustomerService
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CustomerListUiState(
    val list: Loadable<List<Customer>> = Loadable.Loading,
    /**
     * **`null` "arama yapmıyoruz" demek**, "sonuç bulunamadı" değil.
     *
     * İkisini tek tiple temsil etmek, boş bir arama sonucuyla hiç aranmamış bir listeyi
     * karıştırırdı: ekran "eşleşme yok" mu yazacak yoksa listeyi mi çizecek bilemezdi.
     */
    val search: Loadable<List<Customer>>? = null,
    val term: String = "",
    val isLoadingMore: Boolean = false,
    private val nextCursor: String? = null,
) {
    /** Ekranın çizeceği liste: arama varsa o, yoksa gezinme listesi. */
    val visible: Loadable<List<Customer>> get() = search ?: list

    val isSearching: Boolean get() = search != null

    /** Arama sırasında sayfalama YOK: arama ucu zaten sayfalanmıyor. */
    val canLoadMore: Boolean get() = !isSearching && nextCursor != null && !isLoadingMore

    internal val cursor: String? get() = nextCursor
}

/**
 * Müşteri listesi — gezinme ve arama.
 *
 * **Arama ve gezinme AYRI iki yoldur** ve birleştirilmez: liste `GET customers`
 * imleciyle ilerler, arama `GET customers/search`e gider. Aramayı yüklü sayfa üzerinde
 * yerel bir filtreye bırakmak, kullanıcının **hiç görmediği** kayıtları aramamak olurdu
 * — 10 bin müşterinin ilk 50'sinde arama yapan bir ekran, aramıyor demektir.
 *
 * **Debounce ve iptal VAR — A3.4'teki kararın tersine.** `BookingFlowViewModel` bunu
 * bilerek eklememişti ("ölçülmeden eklenen bir kısaltma 'yazdım ama liste gelmedi'
 * hissi üretir") ve o gerekçe randevu akışındaki seçici için hâlâ geçerli: orada
 * aranan küme küçük ve seçim anlıktır. Burada durum farklı — bu ekranın kabul ölçütü
 * "10k müşteride arama gecikmesi hissedilmiyor" ve her tuş vuruşunda ağa çıkmak
 * sunucuya saniyede beş sorgu bindirir. İptal de o yüzden var: iptalsiz çağrılar
 * sırasız dönebilir ve kullanıcı "Ay" yazarken "A"nın sonucunu görebilir.
 */
class CustomerListViewModel(
    private val customers: CustomerService,
) : ViewModel() {
    private val _state = MutableStateFlow(CustomerListUiState())
    val state: StateFlow<CustomerListUiState> = _state.asStateFlow()

    private var searchJob: Job? = null
    private var loadMoreJob: Job? = null

    /** Yüklenmişse tekrar çekmez; şube değişimi gibi gerçek sebepler [reload] çağırır. */
    fun load() {
        if (_state.value.list is Loadable.Loaded) return
        reload()
    }

    fun reload() {
        _state.update { it.copy(list = Loadable.Loading) }
        viewModelScope.launch {
            val page = Loadable.of { customers.list(CustomerListQuery()) }
            _state.update {
                it.copy(
                    list = page.map { result -> result.data },
                    nextCursor = page.valueOrNull?.pageInfo?.nextCursor,
                )
            }
        }
    }

    /**
     * Sonraki sayfa.
     *
     * **Hata listeyi DÜŞÜRMEZ.** Yüklenmiş 200 kaydı bir sayfa hatası yüzünden silmek,
     * kullanıcıyı en başa döndürmek olurdu; imleç yerinde kalır ve tekrar denenebilir.
     */
    fun loadMore() {
        val current = _state.value
        if (!current.canLoadMore || loadMoreJob?.isActive == true) return
        val cursor = current.cursor ?: return

        _state.update { it.copy(isLoadingMore = true) }
        loadMoreJob =
            viewModelScope.launch {
                when (val page = Loadable.of { customers.list(CustomerListQuery(cursor = cursor)) }) {
                    is Loadable.Loaded ->
                        _state.update {
                            it.copy(
                                list = Loadable.Loaded((it.list.valueOrNull ?: emptyList()) + page.value.data),
                                nextCursor = page.value.pageInfo.nextCursor,
                                isLoadingMore = false,
                            )
                        }
                    // İmleç korunur: sayfa gelmedi ama liste ve sıradaki adres duruyor.
                    else -> _state.update { it.copy(isLoadingMore = false) }
                }
            }
    }

    /**
     * Arama terimi değişti.
     *
     * Sunucu `q ≥ 2` istiyor; daha kısası **istek üretmez** ve arama modundan çıkar.
     * Boş bir terimle çağrı yapmak, 400 karşılığında hiçbir şey öğrenmemek olurdu.
     */
    fun search(term: String) {
        val trimmed = term.trim()
        if (trimmed == _state.value.term) return

        searchJob?.cancel()
        _state.update { it.copy(term = trimmed) }

        if (trimmed.length < MIN_SEARCH_LENGTH) {
            _state.update { it.copy(search = null) }
            return
        }

        _state.update { it.copy(search = Loadable.Loading) }
        searchJob =
            viewModelScope.launch {
                delay(SEARCH_DEBOUNCE_MILLIS)
                val result = Loadable.of { customers.search(trimmed) }
                // Terim bu arada değiştiyse bayat sonucu yazma.
                if (_state.value.term == trimmed) _state.update { it.copy(search = result) }
            }
    }

    fun clearSearch() {
        searchJob?.cancel()
        _state.update { it.copy(term = "", search = null) }
    }

    fun retrySearch() {
        val term = _state.value.term
        if (term.length < MIN_SEARCH_LENGTH) return
        _state.update { it.copy(term = "") }
        search(term)
    }

    private fun <T, R> Loadable<T>.map(transform: (T) -> R): Loadable<R> =
        when (this) {
            is Loadable.Loaded -> Loadable.Loaded(transform(value))
            is Loadable.Failed -> this
            Loadable.Loading -> Loadable.Loading
        }

    companion object {
        private const val MIN_SEARCH_LENGTH = 2
        private const val SEARCH_DEBOUNCE_MILLIS = 250L

        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    CustomerListViewModel(container.customers) as T
            }
    }
}
