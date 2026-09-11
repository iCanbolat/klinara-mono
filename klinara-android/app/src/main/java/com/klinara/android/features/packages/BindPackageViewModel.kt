package com.klinara.android.features.packages

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.booking.Appointment
import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.booking.BookingService
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.ConsumePackageInput
import com.klinara.android.services.packages.ConsumePackageLineInput
import com.klinara.android.services.packages.ConsumePackageResult
import com.klinara.android.services.packages.PackageEntitlement
import com.klinara.android.services.packages.PackagesService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

data class BindPackageUiState(
    val appointment: Loadable<Appointment> = Loadable.Loading,
    val entitlements: Loadable<List<PackageEntitlement>> = Loadable.Loading,
    val selectedItemId: String? = null,
    val isSaving: Boolean = false,
    val error: String? = null,
    val result: ConsumePackageResult? = null,
) {
    /**
     * Randevu tamamlanmışsa bağlama seansı HEMEN düşürür; değilse tamamlanmayı bekler.
     * Düğme metni ve dipnot bu farkı kullanıcıya yazıyor.
     */
    val consumesNow: Boolean get() = appointment.valueOrNull?.status == AppointmentStatus.Completed

    val canBind: Boolean get() = selectedItemId != null && !isSaving && result == null
}

/**
 * Randevunun bir hizmet kalemini bir paket hakkına bağlar (A5.2).
 *
 * Yalnız **o hizmetin** hakları listelenir: başka bir hizmetin kalemine bağlamak sunucuda
 * reddediliyor ve listede göstermek boşuna umut olurdu. Liste de sunucudan süzülmüş
 * gelir (aktif, süresi dolmamış, kalanı olan).
 */
class BindPackageViewModel(
    private val booking: BookingService,
    private val packages: PackagesService,
    private val appointmentId: String,
    private val appointmentServiceId: String,
    private val idempotencyKey: String = UUID.randomUUID().toString(),
) : ViewModel() {
    private val _state = MutableStateFlow(BindPackageUiState())
    val state: StateFlow<BindPackageUiState> = _state.asStateFlow()

    fun load() {
        _state.update { it.copy(appointment = Loadable.Loading, entitlements = Loadable.Loading) }
        viewModelScope.launch {
            val appointment = Loadable.of { booking.appointment(appointmentId) }
            _state.update { it.copy(appointment = appointment) }
            val loaded = appointment.valueOrNull ?: return@launch
            val line = loaded.services.firstOrNull { it.id == appointmentServiceId }
            if (line == null) {
                val missing = Loadable.Failed("Randevu kalemi bulunamadı.", isRetryable = false)
                _state.update { it.copy(entitlements = missing) }
                return@launch
            }
            val options =
                Loadable.of {
                    packages.entitlements(loaded.customerId, serviceId = line.serviceId, branchId = loaded.branchId)
                }
            _state.update { it.copy(entitlements = options) }
        }
    }

    fun select(itemId: String) = _state.update { it.copy(selectedItemId = itemId, error = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun bind() {
        val current = _state.value
        val itemId = current.selectedItemId ?: return
        if (!current.canBind) return
        _state.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                val result =
                    packages.consume(
                        appointmentId,
                        ConsumePackageInput(listOf(ConsumePackageLineInput(appointmentServiceId, itemId))),
                        idempotencyKey = idempotencyKey,
                    )
                _state.update { it.copy(isSaving = false, result = result) }
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            appointmentId: String,
            appointmentServiceId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    BindPackageViewModel(
                        container.booking,
                        container.packages,
                        appointmentId,
                        appointmentServiceId,
                    ) as T
            }
    }
}
