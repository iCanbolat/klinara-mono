package com.klinara.android.features.packages

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.CreateCustomerPackageInput
import com.klinara.android.services.packages.CustomerPackage
import com.klinara.android.services.packages.PackageDefinition
import com.klinara.android.services.packages.PackageDefinitionQuery
import com.klinara.android.services.packages.PackagesService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

data class SellPackageUiState(
    /** Yalnız bu şubede SATILABİLİR tanımlar, ada göre sıralı. */
    val options: Loadable<List<PackageDefinition>> = Loadable.Loading,
    val selectedId: String? = null,
    val note: String = "",
    val isSaving: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val sold: CustomerPackage? = null,
) {
    val selected: PackageDefinition? get() = options.valueOrNull?.firstOrNull { it.id == selectedId }
    val canSell: Boolean get() = selected != null && !isSaving
}

/**
 * Paket satışı: tanım seç → önizle → sat (A5.2).
 *
 * **Idempotency anahtarı ViewModel doğarken üretilir ve satış boyunca SABİT kalır.** Ağ
 * hatasından sonra "Sat"a tekrar basmak çok olası; her denemede yeni anahtar üretilseydi
 * müşteri iki paket satın almış olurdu. ViewModel ekranın geri yığını kaydıyla yaşar,
 * döndürmede de korunur — `rememberSaveable`'dan daha dar değil, üstelik ekranın değil
 * satışın ömrüne bağlı.
 *
 * Satış SEÇİLİ ŞUBEDE yapılıyor; liste de o kapsamla SUNUCUDAN istenir. Kapsamsız
 * çekilen listede o şubenin paketi ikinci sayfada kalabilir ve ekran "satılabilir paket
 * yok" derdi.
 */
class SellPackageViewModel(
    private val service: PackagesService,
    private val customerId: String,
    private val branchId: String?,
    private val idempotencyKey: String = UUID.randomUUID().toString(),
) : ViewModel() {
    private val _state = MutableStateFlow(SellPackageUiState())
    val state: StateFlow<SellPackageUiState> = _state.asStateFlow()

    fun load() {
        if (_state.value.options is Loadable.Loaded) return
        _state.update { it.copy(options = Loadable.Loading) }
        viewModelScope.launch {
            val page = Loadable.of { service.definitions(PackageDefinitionQuery(branchId = branchId, isActive = true)) }
            _state.update {
                it.copy(
                    options =
                        when (page) {
                            is Loadable.Loaded ->
                                Loadable.Loaded(
                                    page.value.data
                                        .filter { definition -> definition.isSellable(branchId) }
                                        .sortedBy { definition -> definition.name.lowercase() },
                                )
                            is Loadable.Failed -> page
                            Loadable.Loading -> Loadable.Loading
                        },
                )
            }
        }
    }

    fun select(definitionId: String) = _state.update { it.copy(selectedId = definitionId, error = null) }

    fun setNote(value: String) = _state.update { it.copy(note = value, fieldErrors = emptyMap()) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun sell() {
        val current = _state.value
        val definitionId = current.selectedId ?: return
        if (current.isSaving || current.sold != null) return
        _state.update { it.copy(isSaving = true, error = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                val sold =
                    service.sell(
                        CreateCustomerPackageInput(
                            customerId = customerId,
                            definitionId = definitionId,
                            note = current.note.trim().ifEmpty { null },
                        ),
                        idempotencyKey = idempotencyKey,
                    )
                _state.update { it.copy(isSaving = false, sold = sold) }
            } catch (error: ApiError) {
                _state.update {
                    it.copy(
                        isSaving = false,
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
            customerId: String,
            branchId: String?,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    SellPackageViewModel(container.packages, customerId, branchId) as T
            }
    }
}
