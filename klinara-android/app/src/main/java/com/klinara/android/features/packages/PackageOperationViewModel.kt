package com.klinara.android.features.packages

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerService
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.AdjustItemInput
import com.klinara.android.services.packages.AdjustPackageInput
import com.klinara.android.services.packages.CustomerPackage
import com.klinara.android.services.packages.PackagesService
import com.klinara.android.services.packages.RefundPackageInput
import com.klinara.android.services.packages.SessionsItemInput
import com.klinara.android.services.packages.TransferPackageInput
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

/** Paket üzerindeki üç işlem — her biri AYRI bir izinle kapılı (A5.3). */
enum class PackageOperation(val wire: String) {
    Adjust("adjust"),
    Refund("refund"),
    Transfer("transfer"),
    ;

    companion object {
        fun from(wire: String): PackageOperation = entries.first { it.wire == wire }
    }
}

data class PackageOperationUiState(
    val pkg: Loadable<CustomerPackage> = Loadable.Loading,
    /** Kalem kimliği → düzeltmede delta, iade/devirde seans sayısı. Sıfırlar gönderilmez. */
    val amounts: Map<String, Int> = emptyMap(),
    /** İade/devirde "tüm kalan hak" — `items` hiç gönderilmez, sunucu hesaplar. */
    val isWhole: Boolean = true,
    val reason: String = "",
    val customerQuery: String = "",
    val candidates: List<Customer> = emptyList(),
    val target: Customer? = null,
    val isSaving: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val isDone: Boolean = false,
) {
    private val openItems get() = pkg.valueOrNull?.sortedItems.orEmpty().filter { it.remainingSessions > 0 }

    val adjustInput: AdjustPackageInput
        get() =
            AdjustPackageInput(
                items =
                    pkg.valueOrNull?.sortedItems.orEmpty().mapNotNull { item ->
                        amounts[item.id]?.takeIf { it != 0 }?.let { AdjustItemInput(item.id, it) }
                    },
                reason = reason,
            )

    private val selectedSessions: List<SessionsItemInput>
        get() =
            openItems.mapNotNull { item ->
                amounts[item.id]?.takeIf { it > 0 }?.let { SessionsItemInput(item.id, it) }
            }

    val refundInput: RefundPackageInput
        get() = RefundPackageInput(items = if (isWhole) null else selectedSessions, reason = reason)

    val transferInput: TransferPackageInput
        get() =
            TransferPackageInput(
                targetCustomerId = target?.id.orEmpty(),
                items = if (isWhole) null else selectedSessions,
                reason = reason,
            )

    fun canSubmit(operation: PackageOperation): Boolean =
        !isSaving && pkg is Loadable.Loaded &&
            when (operation) {
                PackageOperation.Adjust -> adjustInput.isValid
                PackageOperation.Refund -> refundInput.isValid
                PackageOperation.Transfer -> transferInput.isValid
            }

    /**
     * İade TAHMİNİ — sunucuyla aynı kural: kalem tahsisinin seans başına payı. Son sözü
     * sunucu söyler, ama kullanıcı ne kadar iade edeceğini basmadan önce görmeli.
     */
    val estimatedRefundMinor: Long
        get() =
            openItems.sumOf { item ->
                val sessions = if (isWhole) item.remainingSessions else amounts[item.id] ?: 0
                item.unitAllocationMinor * sessions
            }
}

/**
 * Düzeltme, iade ve devir (A5.3) — üç ekranın ortak durumu.
 *
 * Paket **açılışta yeniden çekilir**: `If-Match` taze bir `version` taşımalı. İade ve devrin
 * idempotency anahtarı ViewModel doğarken üretilir ve ekran boyunca sabit kalır.
 *
 * Başarıdan sonra ekran kapanır; detay ve kart dönüşte sunucudan TAZE gelir. Yanıttan
 * yerel bir kopya güncellenmiyor: iade yanıtı paketi hiç taşımıyor, devir yanıtı ise
 * KAYNAĞI değil hedefi taşıyor — ikisini de "yerelde düzeltmek" tahmin olurdu.
 */
class PackageOperationViewModel(
    private val service: PackagesService,
    private val customers: CustomerService,
    private val packageId: String,
    private val idempotencyKey: String = UUID.randomUUID().toString(),
) : ViewModel() {
    private val _state = MutableStateFlow(PackageOperationUiState())
    val state: StateFlow<PackageOperationUiState> = _state.asStateFlow()

    private var searchJob: Job? = null

    fun load() {
        _state.update { it.copy(pkg = Loadable.Loading) }
        viewModelScope.launch {
            _state.update { it.copy(pkg = Loadable.of { service.customerPackage(packageId) }) }
        }
    }

    fun setAmount(
        itemId: String,
        value: Int,
    ) = _state.update { it.copy(amounts = it.amounts + (itemId to value), error = null) }

    fun setWhole(value: Boolean) = _state.update { it.copy(isWhole = value, error = null) }

    fun setReason(value: String) = _state.update { it.copy(reason = value, fieldErrors = emptyMap()) }

    fun dismissError() = _state.update { it.copy(error = null) }

    /** Hedef müşteri araması — sunucu `q ≥ 2` istiyor, gecikmeli ve önceki istek iptal. */
    fun searchCustomers(query: String) {
        _state.update { it.copy(customerQuery = query) }
        searchJob?.cancel()
        if (query.trim().length < MIN_QUERY) {
            _state.update { it.copy(candidates = emptyList()) }
            return
        }
        searchJob =
            viewModelScope.launch {
                delay(SEARCH_DEBOUNCE_MILLIS)
                val found = Loadable.of { customers.search(query.trim()) }.valueOrNull.orEmpty()
                // Kaynak müşteri listeden DÜŞER: sunucu da reddediyor, seçilip reddedilecek
                // bir seçenek sunmak kullanıcıyı boşuna yorar.
                val owner = _state.value.pkg.valueOrNull?.customerId
                _state.update { it.copy(candidates = found.filter { customer -> customer.id != owner }) }
            }
    }

    fun selectTarget(customer: Customer) = _state.update { it.copy(target = customer, error = null) }

    fun submit(operation: PackageOperation) {
        val current = _state.value
        val pkg = current.pkg.valueOrNull ?: return
        if (!current.canSubmit(operation)) return
        _state.update { it.copy(isSaving = true, error = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                when (operation) {
                    PackageOperation.Adjust -> service.adjust(pkg.id, pkg.version, current.adjustInput)
                    PackageOperation.Refund -> service.refund(pkg.id, pkg.version, current.refundInput, idempotencyKey)
                    PackageOperation.Transfer ->
                        service.transfer(pkg.id, pkg.version, current.transferInput, idempotencyKey)
                }
                _state.update { it.copy(isSaving = false, isDone = true) }
            } catch (error: ApiError) {
                _state.update {
                    it.copy(
                        isSaving = false,
                        error = if (error.isFieldScoped) null else error.displayMessage,
                        fieldErrors = error.fieldErrors,
                    )
                }
                // Bayat sürüm: kaydı tazele ki bir sonraki deneme doğru `If-Match` ile gitsin.
                // Form (seçimler, gerekçe) YERİNDE kalır — kullanıcı yeni kalana bakıp karar verir.
                if (error.code == ApiErrorCode.VERSION_CONFLICT) refreshPackage()
            }
        }
    }

    private fun refreshPackage() {
        viewModelScope.launch {
            val fresh = Loadable.of { service.customerPackage(packageId) }
            if (fresh is Loadable.Loaded) _state.update { it.copy(pkg = fresh) }
        }
    }

    companion object {
        private const val MIN_QUERY = 2
        private const val SEARCH_DEBOUNCE_MILLIS = 300L

        fun factory(
            container: ServiceContainer,
            packageId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    PackageOperationViewModel(container.packages, container.customers, packageId) as T
            }
    }
}
