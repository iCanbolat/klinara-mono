package com.klinara.android.features.packages

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.PackageDefinition
import com.klinara.android.services.packages.PackageDefinitionQuery
import com.klinara.android.services.packages.PackagesService
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PackageDefinitionListUiState(
    val definitions: Loadable<List<PackageDefinition>> = Loadable.Loading,
    /**
     * Listenin sunucu tarafındaki şube kapsamı. `null` **tüm şubeler**.
     *
     * Kapsam istemcide süzülmüyor: 200 tanımlı bir kiracıda o şubenin paketi üçüncü
     * sayfada olabilir ve satış sayfası, listeyi kaydırmadan "satılabilir paket yok" derdi.
     */
    val branchScope: String? = null,
    val isLoadingMore: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    val pendingRetirement: PackageDefinition? = null,
    private val cursor: String? = null,
    private val hasLoadedScope: Boolean = false,
) {
    val canLoadMore: Boolean get() = cursor != null && !isLoadingMore
    internal val nextCursor: String? get() = cursor
    internal val loadedScope: Boolean get() = hasLoadedScope

    /** Satılabilir olanlar — satış sayfası bu listeden seçtirir, sunucu da diğerlerini reddeder. */
    fun sellable(branchId: String?): List<PackageDefinition> =
        definitions.valueOrNull.orEmpty().filter { it.isSellable(branchId) }
}

/**
 * Paket tanımları listesi (A5.1) — Yönetim'deki tanım ekranını ve müşteri kartındaki
 * **satış sayfasını** besler.
 *
 * iOS'ta bu oturum ömürlü tek bir store (`session.packageDefinitionStore`) ve iki ekran
 * onu PAYLAŞIYOR. Android'de oturum ömürlü store kalıbı yok; her ekran kendi örneğini
 * `viewModel(key = …)` ile alıyor ve listeyi kendisi çekiyor. Bedeli bir ekstra istek;
 * kazancı A2.1'de kurulan tek DI kalıbından sapmamak. Paylaşımın iOS'taki gerekçesi
 * ("az önce oluşturulan paket satış listesinde görünmüyordu") burada doğmuyor: satış
 * sayfası her açılışta taze çekiyor.
 *
 * **Kapsamı her ekran kendisi söyler** ([ensureScope]). Kapsamı "en son kim ayarladıysa o"
 * bırakmak, bir ekranın başka bir ekranın filtresini miras alması demekti.
 */
class PackageDefinitionListViewModel(
    private val service: PackagesService,
) : ViewModel() {
    private val _state = MutableStateFlow(PackageDefinitionListUiState())
    val state: StateFlow<PackageDefinitionListUiState> = _state.asStateFlow()

    private var loadJob: Job? = null

    /**
     * Ekranın kapsamını bildirir. Kapsam değiştiyse (ya da hiç yüklenmediyse) listeyi
     * "yükleniyor"a çekip yeniden getirir; aynı kapsamda ise **sessizce tazeler** — eldeki
     * liste yerinde durur, yalnız başarılı yanıt onu değiştirir.
     *
     * Sessiz tazeleme editörden dönüşün karşılığı: gezinme geri dönünce ekranın
     * `LaunchedEffect`'i yeniden koşuyor. Kaydedilen kaydı route üzerinden geri taşımak
     * yerine taze liste — tek bir istek, ve başka bir oturumun yazdığını da yakalıyor.
     */
    fun ensureScope(branchId: String?) {
        val current = _state.value
        val sameScope = current.loadedScope && current.branchScope == branchId
        if (sameScope && current.definitions is Loadable.Loaded) {
            refreshSilently()
            return
        }
        _state.update { it.copy(branchScope = branchId) }
        reload()
    }

    private fun refreshSilently() {
        if (loadJob?.isActive == true) return
        val scope = _state.value.branchScope
        loadJob =
            viewModelScope.launch {
                val page = Loadable.of { service.definitions(PackageDefinitionQuery(branchId = scope)) }
                if (page is Loadable.Loaded) {
                    _state.update {
                        it.copy(definitions = Loadable.Loaded(page.value.data), cursor = page.value.pageInfo.nextCursor)
                    }
                }
            }
    }

    fun reload() {
        loadJob?.cancel()
        val scope = _state.value.branchScope
        _state.update { it.copy(definitions = Loadable.Loading, cursor = null, hasLoadedScope = true) }
        loadJob =
            viewModelScope.launch {
                val page = Loadable.of { service.definitions(PackageDefinitionQuery(branchId = scope)) }
                _state.update {
                    it.copy(
                        definitions = page.map { value -> value.data },
                        cursor = page.valueOrNull?.pageInfo?.nextCursor,
                    )
                }
            }
    }

    /** Sonraki sayfa. Hata listeyi DÜŞÜRMEZ ve imleç korunur — kaydırma tekrar dener. */
    fun loadMore() {
        val current = _state.value
        if (!current.canLoadMore) return
        val cursor = current.nextCursor ?: return
        _state.update { it.copy(isLoadingMore = true) }
        viewModelScope.launch {
            val query = PackageDefinitionQuery(cursor = cursor, branchId = current.branchScope)
            when (val page = Loadable.of { service.definitions(query) }) {
                is Loadable.Loaded ->
                    _state.update {
                        it.copy(
                            definitions = Loadable.Loaded(it.definitions.valueOrNull.orEmpty() + page.value.data),
                            cursor = page.value.pageInfo.nextCursor,
                            isLoadingMore = false,
                        )
                    }
                else -> _state.update { it.copy(isLoadingMore = false) }
            }
        }
    }

    fun askRetire(definition: PackageDefinition) = _state.update { it.copy(pendingRetirement = definition) }

    fun cancelRetire() = _state.update { it.copy(pendingRetirement = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    /**
     * Satılmamışsa arşivler, satılmışsa yalnız pasife alır. Sunucu gövde döndürmüyor (204),
     * bu yüzden kayıt **yeniden çekilir**: hangisinin olduğunu yerelde tahmin etmek iki
     * durumu karıştırırdı.
     */
    fun confirmRetire() {
        val target = _state.value.pendingRetirement ?: return
        if (_state.value.isSaving) return
        _state.update { it.copy(pendingRetirement = null, isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                service.retireDefinition(target.id, target.version)
                // `runCatching` DEĞİL: iptal istisnasını da yutar ve ekran kapanırken
                // yarım kalmış bir yazma "arşivlendi" diye işlenirdi.
                val refreshed =
                    try {
                        service.definition(target.id)
                    } catch (_: ApiError) {
                        null
                    }
                _state.update { state ->
                    val list = state.definitions.valueOrNull.orEmpty()
                    val updated =
                        if (refreshed != null && !refreshed.isArchived) {
                            list.map { if (it.id == target.id) refreshed else it }
                        } else {
                            list.filterNot { it.id == target.id }
                        }
                    state.copy(definitions = Loadable.Loaded(updated), isSaving = false)
                }
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
            }
        }
    }

    companion object {
        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    PackageDefinitionListViewModel(container.packages) as T
            }
    }
}

private inline fun <T, R> Loadable<T>.map(transform: (T) -> R): Loadable<R> =
    when (this) {
        is Loadable.Loaded -> Loadable.Loaded(transform(value))
        is Loadable.Failed -> this
        Loadable.Loading -> Loadable.Loading
    }
