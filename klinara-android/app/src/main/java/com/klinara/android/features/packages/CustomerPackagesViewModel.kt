package com.klinara.android.features.packages

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.CustomerPackage
import com.klinara.android.services.packages.CustomerPackageQuery
import com.klinara.android.services.packages.PackagesService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CustomerPackagesUiState(
    val packages: Loadable<List<CustomerPackage>> = Loadable.Loading,
    val isLoadingMore: Boolean = false,
    private val cursor: String? = null,
) {
    val canLoadMore: Boolean get() = cursor != null && !isLoadingMore
    internal val nextCursor: String? get() = cursor

    /**
     * Açık paketler önce, kapanmışlar sonra; her grup içinde yeni satış üstte.
     *
     * Kartın cevapladığı soru "kaç seansı kaldı?" — resepsiyonun randevu açarken sorduğu.
     * Satış geçmişi ikinci sırada.
     */
    val ordered: List<CustomerPackage>
        get() =
            packages.valueOrNull.orEmpty().sortedWith(
                compareByDescending<CustomerPackage> { it.isOpenWithBalance }.thenByDescending { it.soldAt },
            )

    /**
     * Açık paketlerdeki toplam hak — yalnız GÖSTERİM özeti. Sunucunun paket başına
     * döndürdüğü `remainingSessions`'ların toplamı; defterden bağımsız bir hesap değil.
     */
    val totalRemainingSessions: Int
        get() = packages.valueOrNull.orEmpty().filter { it.isOpenWithBalance }.sumOf { it.remainingSessions }
}

/**
 * Müşteri kartının paket bölümü (A5.2).
 *
 * Kartla birlikte doğar ve ölür (`CustomerRecordViewModel` gerekçesi): açılmış her
 * müşterinin paketlerini oturum boyunca bellekte tutmanın anlamı yok.
 *
 * **Kalan hak burada hesaplanmaz, yerelde güncellenmez de.** Satış, düzeltme, iade ve
 * devir kendi ekranlarında yapılıyor; karta dönünce gezinme bu bölümü yeniden kuruyor ve
 * liste sunucudan TAZE geliyor. İstemcide "−1" yazan tek bir satır, defterle ayrışabilen
 * ikinci bir sayaç olurdu.
 */
class CustomerPackagesViewModel(
    private val service: PackagesService,
    private val customerId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(CustomerPackagesUiState())
    val state: StateFlow<CustomerPackagesUiState> = _state.asStateFlow()

    /**
     * Yükler. Elde bir liste varsa "yükleniyor"a DÜŞMEZ — karta dönüşte bölüm titremesin;
     * yalnız başarılı yanıt listeyi değiştirir.
     */
    fun load() {
        val hasList = _state.value.packages is Loadable.Loaded
        if (!hasList) _state.update { it.copy(packages = Loadable.Loading, cursor = null) }
        viewModelScope.launch {
            val page = Loadable.of { service.packages(customerId) }
            _state.update { current ->
                when {
                    page is Loadable.Loaded ->
                        current.copy(
                            packages = Loadable.Loaded(page.value.data),
                            cursor = page.value.pageInfo.nextCursor,
                        )
                    hasList -> current
                    else -> current.copy(packages = page as Loadable.Failed)
                }
            }
        }
    }

    fun loadMore() {
        val current = _state.value
        if (!current.canLoadMore) return
        val cursor = current.nextCursor ?: return
        _state.update { it.copy(isLoadingMore = true) }
        viewModelScope.launch {
            when (val page = Loadable.of { service.packages(customerId, CustomerPackageQuery(cursor = cursor)) }) {
                is Loadable.Loaded ->
                    _state.update {
                        it.copy(
                            packages = Loadable.Loaded(it.packages.valueOrNull.orEmpty() + page.value.data),
                            cursor = page.value.pageInfo.nextCursor,
                            isLoadingMore = false,
                        )
                    }
                // İmleç korunur; yüklenmiş liste düşmez.
                else -> _state.update { it.copy(isLoadingMore = false) }
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
                    CustomerPackagesViewModel(container.packages, customerId) as T
            }
    }
}
