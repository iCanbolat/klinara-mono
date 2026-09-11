package com.klinara.android.features.packages

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.CustomerPackage
import com.klinara.android.services.packages.PackageLedgerEntry
import com.klinara.android.services.packages.PackagesService
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CustomerPackageDetailUiState(
    val pkg: Loadable<CustomerPackage> = Loadable.Loading,
    val ledger: Loadable<List<PackageLedgerEntry>> = Loadable.Loading,
    val isLoadingMoreLedger: Boolean = false,
    private val ledgerCursor: String? = null,
) {
    val canLoadMoreLedger: Boolean get() = ledgerCursor != null && !isLoadingMoreLedger
    internal val nextLedgerCursor: String? get() = ledgerCursor
}

/**
 * Müşteri paketi detayı: kalemler, defter ve (A5.3) işlemler.
 *
 * Ekran **kimlikle** açılır ve paketi **yeniden çeker**: liste ucundan gelen `version`
 * bayat olabilir ve `If-Match` bayat başlarsa ilk düzeltme denemesi boşuna 409 alır.
 * Paket ve defter PARALEL yüklenir, ayrı `Loadable`'larla — biri düşerken diğeri gelmiş
 * olabilir.
 */
class CustomerPackageDetailViewModel(
    private val service: PackagesService,
    private val packageId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(CustomerPackageDetailUiState())
    val state: StateFlow<CustomerPackageDetailUiState> = _state.asStateFlow()

    /**
     * İşlem sheet'inden dönüşte de koşar. Elde bir kayıt varsa "yükleniyor"a düşmez;
     * yalnız başarılı yanıt değiştirir — ekran titremez, bayat kalmaz.
     */
    fun load() {
        viewModelScope.launch {
            val pkg = async { Loadable.of { service.customerPackage(packageId) } }
            val ledger = async { Loadable.of { service.ledger(packageId) } }
            val loadedPackage = pkg.await()
            val loadedLedger = ledger.await()
            _state.update { current ->
                current.copy(
                    pkg = loadedPackage.keepLoaded(current.pkg),
                    ledger = loadedLedger.map { it.data }.keepLoaded(current.ledger),
                    ledgerCursor = loadedLedger.valueOrNull?.pageInfo?.nextCursor ?: current.nextLedgerCursor,
                )
            }
        }
    }

    fun loadMoreLedger() {
        val current = _state.value
        if (!current.canLoadMoreLedger) return
        val cursor = current.nextLedgerCursor ?: return
        _state.update { it.copy(isLoadingMoreLedger = true) }
        viewModelScope.launch {
            when (val page = Loadable.of { service.ledger(packageId, cursor = cursor) }) {
                is Loadable.Loaded ->
                    _state.update {
                        it.copy(
                            ledger = Loadable.Loaded(it.ledger.valueOrNull.orEmpty() + page.value.data),
                            ledgerCursor = page.value.pageInfo.nextCursor,
                            isLoadingMoreLedger = false,
                        )
                    }
                else -> _state.update { it.copy(isLoadingMoreLedger = false) }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            packageId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    CustomerPackageDetailViewModel(container.packages, packageId) as T
            }
    }
}

/** Yeni yanıt başarısızsa ve elde yüklü bir değer varsa ESKİSİ kalır — tazeleme hatası ekranı silmez. */
private fun <T> Loadable<T>.keepLoaded(previous: Loadable<T>): Loadable<T> =
    if (this is Loadable.Failed && previous is Loadable.Loaded) previous else this

private inline fun <T, R> Loadable<T>.map(transform: (T) -> R): Loadable<R> =
    when (this) {
        is Loadable.Loaded -> Loadable.Loaded(transform(value))
        is Loadable.Failed -> this
        Loadable.Loading -> Loadable.Loading
    }
