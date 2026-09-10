package com.klinara.android.features.calendar.booking

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.booking.Appointment
import com.klinara.android.services.booking.AvailabilityQuery
import com.klinara.android.services.booking.AvailabilitySlot
import com.klinara.android.services.booking.BookingService
import com.klinara.android.services.catalog.CatalogService
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerService
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.staff.StaffProfile
import com.klinara.android.services.staff.StaffService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

data class BookingUiState(
    val draft: BookingDraft,
    val day: Instant,
    val services: Loadable<List<ClinicService>> = Loadable.Loading,
    val staff: Loadable<List<StaffProfile>> = Loadable.Loading,
    val customers: List<Customer> = emptyList(),
    val customerQuery: String = "",
    val slots: Loadable<List<AvailabilitySlot>> = Loadable.Loading,
    val isSaving: Boolean = false,
    val error: String? = null,
    /** Çakışma bir HATA değil, bir bilgidir: ayrı bir sayfada alternatiflerle gösterilir. */
    val conflict: ApiError? = null,
    val created: Appointment? = null,
) {
    val activeServices: List<ClinicService>
        get() = services.valueOrNull.orEmpty().filter { it.isActive }

    val eligibleStaff: List<StaffProfile>
        get() = draft.eligibleStaff(staff.valueOrNull.orEmpty())

    /** Seçili personelin veremediği slotlar listede görünmemeli. */
    val visibleSlots: List<AvailabilitySlot>
        get() = slots.valueOrNull.orEmpty().filter { it.supports(draft.staffProfileId) }
}

/**
 * Randevu oluşturma ve erteleme.
 *
 * **Sihirbaz değil, tek sayfa** (iOS ile aynı): bölümler ilerledikçe açılıyor. Adım adım
 * bir sihirbaz, hizmeti değiştirmek için üç ekran geri gitmeyi gerektirirdi ve rezervasyon
 * en sık düzeltilen formdur.
 */
class BookingFlowViewModel(
    private val booking: BookingService,
    private val catalog: CatalogService,
    private val staff: StaffService,
    private val customers: CustomerService,
    private val clock: BranchClock,
    branchId: String,
    rescheduling: Appointment? = null,
    startingAt: Instant? = null,
) : ViewModel() {
    private val _state =
        MutableStateFlow(
            BookingUiState(
                draft = rescheduling?.let { BookingDraft.rescheduling(it) } ?: BookingDraft(branchId = branchId),
                day = clock.startOfDay(startingAt ?: rescheduling?.startsAt ?: Instant.now()),
            ),
        )
    val state: StateFlow<BookingUiState> = _state.asStateFlow()

    /** Uygunluk anahtarı: gün, hizmet dizisi ve personel. Üçü de süreyi/uygunluğu değiştirir. */
    data class AvailabilityKey(
        val day: String,
        val serviceIds: List<String>,
        val staffProfileId: String?,
    )

    fun availabilityKey(): AvailabilityKey {
        val current = _state.value
        return AvailabilityKey(
            clock.localDateString(current.day),
            current.draft.serviceIds,
            current.draft.staffProfileId,
        )
    }

    fun load() {
        viewModelScope.launch { _state.update { it.copy(services = Loadable.of { catalog.services() }) } }
        viewModelScope.launch { _state.update { it.copy(staff = Loadable.of { staff.list() }) } }
        // Erteleme sırasında müşteri kilitli ama ADI gösterilmeli.
        _state.value.draft.customerId?.let { id ->
            viewModelScope.launch {
                Loadable.of { customers.get(id) }.valueOrNull?.let { customer ->
                    _state.update { it.copy(customers = (it.customers + customer).distinctBy { c -> c.id }) }
                }
            }
        }
    }

    fun loadSlots() {
        val current = _state.value
        if (!current.draft.canQueryAvailability) {
            // Hizmet seçilmeden uygunluk SORULMAZ: süre bilinmiyor ve sunucu
            // boş `serviceIds` ile 400 verirdi.
            _state.update { it.copy(slots = Loadable.Loaded(emptyList())) }
            return
        }
        _state.update { it.copy(slots = Loadable.Loading) }
        viewModelScope.launch {
            val from = current.day
            val next =
                Loadable.of {
                    booking
                        .availability(
                            AvailabilityQuery(
                                branchId = current.draft.branchId,
                                serviceIds = current.draft.serviceIds,
                                from = from,
                                to = clock.adding(1, from),
                                staffProfileId = current.draft.staffProfileId,
                            ),
                        ).slots
                }
            _state.update { it.copy(slots = next) }
        }
    }

    /**
     * Müşteri araması.
     *
     * Her tuşta ağa çıkılıyor; kısaltma (debounce) EKLENMEDİ çünkü mock'ta gecikme yok
     * ve canlıda sunucu tarafı arama zaten hızlı. Gerçek bir sorun ölçülürse eklenir —
     * ölçülmeden eklenen bir kısaltma, "yazdım ama liste gelmedi" hissi üretir.
     */
    fun searchCustomers(query: String) {
        _state.update { it.copy(customerQuery = query) }
        if (query.isBlank()) return
        viewModelScope.launch {
            val found = Loadable.of { customers.search(query) }.valueOrNull.orEmpty()
            // Seçili müşteri listeden düşmemeli: arama daralınca adı kaybolurdu.
            val selected = _state.value.customers.filter { it.id == _state.value.draft.customerId }
            _state.update { it.copy(customers = (found + selected).distinctBy { c -> c.id }) }
        }
    }

    fun addCustomer(customer: Customer) =
        _state.update {
            it.copy(
                customers = (it.customers + customer).distinctBy { c -> c.id },
                draft = it.draft.selectCustomer(customer.id),
            )
        }

    fun selectCustomer(id: String) = _state.update { it.copy(draft = it.draft.selectCustomer(id)) }

    fun toggleService(id: String) = _state.update { it.copy(draft = it.draft.toggleService(id)) }

    fun selectStaff(id: String?) = _state.update { it.copy(draft = it.draft.selectStaff(id)) }

    fun selectSlot(slot: AvailabilitySlot) = _state.update { it.copy(draft = it.draft.selectSlot(slot)) }

    fun setNotes(value: String) = _state.update { it.copy(draft = it.draft.copy(notes = value)) }

    fun setReason(value: String) = _state.update { it.copy(draft = it.draft.copy(reason = value)) }

    fun stepDay(direction: Long) =
        _state.update { it.copy(day = clock.adding(direction, it.day), draft = it.draft.copy(slot = null)) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun dismissConflict() = _state.update { it.copy(conflict = null) }

    /** Öneriye dokunmak taslağı DOLDURUR, kaydetmez — son sözü kullanıcı söyler. */
    fun applySuggestion(slot: AvailabilitySlot) {
        _state.update {
            it.copy(
                conflict = null,
                day = clock.startOfDay(slot.startsAt),
                draft = it.draft.selectSlot(slot),
            )
        }
        loadSlots()
    }

    fun save() {
        val current = _state.value
        // Çift dokunuşu engelleyen şey BU bayrak, idempotency anahtarı değil:
        // anahtar ağ tekrarına karşıdır.
        if (current.isSaving || !current.draft.isValid) return
        _state.update { it.copy(isSaving = true, error = null) }

        viewModelScope.launch {
            try {
                val saved =
                    current.draft.rescheduling?.let { existing ->
                        val input = current.draft.rescheduleInput(clock) ?: return@launch
                        booking.reschedule(existing.id, existing.version, input)
                    } ?: run {
                        val input = current.draft.createInput(clock) ?: return@launch
                        // HER denemede YENİ anahtar: düzeltilmiş bir gövdeyi aynı
                        // anahtarla göndermek 409 IDEMPOTENCY_CONFLICT verirdi.
                        booking.create(input, idempotencyKey = UUID.randomUUID().toString())
                    }
                _state.update { it.copy(isSaving = false, created = saved) }
            } catch (error: ApiError) {
                if (error.code == ApiErrorCode.SLOT_CONFLICT) {
                    // Çakışma bir hata metni değil, alternatif saatlerdir. Seçili slot
                    // düşürülüyor ve liste tazeleniyor: kullanıcı aynı dolu saati tekrar
                    // denemesin.
                    _state.update { it.copy(isSaving = false, conflict = error, draft = it.draft.copy(slot = null)) }
                    loadSlots()
                } else {
                    _state.update { it.copy(isSaving = false, error = error.displayMessage) }
                }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            clock: BranchClock,
            branchId: String,
            rescheduling: Appointment? = null,
            startingAt: Instant? = null,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    BookingFlowViewModel(
                        container.booking,
                        container.catalog,
                        container.staff,
                        container.customers,
                        clock,
                        branchId,
                        rescheduling,
                        startingAt,
                    ) as T
            }
    }
}
