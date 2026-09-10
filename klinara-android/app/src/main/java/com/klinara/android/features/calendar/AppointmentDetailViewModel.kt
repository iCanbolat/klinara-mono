package com.klinara.android.features.calendar

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.booking.Appointment
import com.klinara.android.services.booking.AppointmentHistoryEntry
import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.booking.BookingService
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerService
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.staff.StaffProfile
import com.klinara.android.services.staff.StaffService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AppointmentDetailUiState(
    val appointment: Loadable<Appointment> = Loadable.Loading,
    val staff: Loadable<List<StaffProfile>> = Loadable.Loading,
    /**
     * Müşteri AYRI bir çağrıdan gelir: `AppointmentResponseDto` adı taşımıyor.
     * Bağımsız düşer — müşteri kartı gelmese de randevunun saati, tutarı ve durumu
     * ekranda kalmalı.
     */
    val customer: Loadable<Customer> = Loadable.Loading,
    val isSaving: Boolean = false,
    /** Yazma hatası afişi. Kayıt DEĞİŞMEZ — okunan hâli ekranda kalır. */
    val error: String? = null,
    /** Onay bekleyen durum geçişi. */
    val pendingStatus: AppointmentStatus? = null,
) {
    fun staffName(staffProfileId: String): String =
        staff.valueOrNull?.firstOrNull { it.id == staffProfileId }?.userFullName ?: "Personel"

    fun staffColor(staffProfileId: String): String? =
        staff.valueOrNull?.firstOrNull { it.id == staffProfileId }?.calendarColor
}

/**
 * Randevu detayı.
 *
 * **Okuma ile yazma ayrı ele alınır** (iOS'takiyle aynı kural): okuma başarısızlığı
 * ekranı `Failed`'a düşürür, yazma başarısızlığı yalnız bir afiş gösterir ve okunan
 * kayda dokunmaz. Bir durum değiştirme denemesinin başarısız olması, kullanıcının
 * baktığı randevuyu ekrandan silmek için sebep değil.
 *
 * **İyimser güncelleme YOK.** Sunucu geçişi reddedebilir (409 `INVALID_STATUS_TRANSITION`,
 * 403 `appointment:reopen`); satırı önce değiştirip sonra geri almak, kullanıcıya bir an
 * için gerçekleşmemiş bir şeyi göstermek olurdu (A2.2'deki passkey kararının aynısı).
 */
class AppointmentDetailViewModel(
    private val booking: BookingService,
    private val staff: StaffService,
    private val customers: CustomerService,
    private val appointmentId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(AppointmentDetailUiState())
    val state: StateFlow<AppointmentDetailUiState> = _state.asStateFlow()

    fun load() {
        _state.update { it.copy(appointment = Loadable.Loading) }
        viewModelScope.launch {
            val loaded = Loadable.of { booking.appointment(appointmentId) }
            _state.update { it.copy(appointment = loaded) }
            // Müşteri ancak randevu geldikten SONRA istenebilir (kimliği ondan geliyor).
            loaded.valueOrNull?.let { appointment ->
                _state.update { it.copy(customer = Loadable.of { customers.get(appointment.customerId) }) }
            }
        }
        loadStaff()
    }

    private fun loadStaff() {
        if (_state.value.staff is Loadable.Loaded) return
        viewModelScope.launch {
            _state.update { it.copy(staff = Loadable.of { staff.list() }) }
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun askStatus(status: AppointmentStatus) = _state.update { it.copy(pendingStatus = status) }

    fun cancelStatusPrompt() = _state.update { it.copy(pendingStatus = null) }

    fun confirmStatus() {
        val status = _state.value.pendingStatus ?: return
        _state.update { it.copy(pendingStatus = null) }
        mutate { current -> booking.changeStatus(current.id, status) }
    }

    fun cancelAppointment(reason: String?) =
        mutate { current -> booking.cancel(current.id, reason?.trim()?.takeIf { it.isNotEmpty() }) }

    /**
     * Notu kaydeder. Boş metin `null` gönderir ve notu **siler** — ekran bunu dipnotla
     * söylüyor, çünkü "temizleyip kaydet" ile "silmek" arasındaki farkı kullanıcı
     * kaydettikten sonra öğrenmemeli.
     */
    fun saveNotes(notes: String) =
        mutate { current ->
            booking.updateNotes(current.id, current.version, notes.trim().takeIf { it.isNotEmpty() })
        }

    /**
     * Ortak yazma sarmalayıcısı.
     *
     * Dönen gövdeden gelen kayıt **doğrudan** duruma yazılır; yeniden `GET` yapılmaz.
     * `cancel` ve `status` uçları `ETag` başlığı döndürmüyor ama gövdeleri `version`
     * taşıyor — sürümü oradan almazsak bir sonraki not kaydı, kullanıcının KENDİ
     * değişikliği yüzünden 409 alırdı.
     */
    private fun mutate(block: suspend (Appointment) -> Appointment) {
        val current = _state.value.appointment.valueOrNull ?: return
        if (_state.value.isSaving) return
        _state.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                val updated = block(current)
                _state.update { it.copy(isSaving = false, appointment = Loadable.Loaded(updated)) }
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            appointmentId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    AppointmentDetailViewModel(
                        container.booking,
                        container.staff,
                        container.customers,
                        appointmentId,
                    ) as T
            }
    }
}

/** Geçmiş ekranının kendi küçük durumu — detayla aynı ömre bağlı değil. */
class AppointmentHistoryViewModel(
    private val booking: BookingService,
    private val appointmentId: String,
) : ViewModel() {
    private val _state = MutableStateFlow<Loadable<List<AppointmentHistoryEntry>>>(Loadable.Loading)
    val state: StateFlow<Loadable<List<AppointmentHistoryEntry>>> = _state.asStateFlow()

    fun load() {
        _state.value = Loadable.Loading
        viewModelScope.launch { _state.value = Loadable.of { booking.history(appointmentId) } }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            appointmentId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    AppointmentHistoryViewModel(container.booking, appointmentId) as T
            }
    }
}
