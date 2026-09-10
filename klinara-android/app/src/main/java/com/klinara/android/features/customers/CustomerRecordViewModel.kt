package com.klinara.android.features.customers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.crm.CustomerNote
import com.klinara.android.services.crm.CustomerNoteKind
import com.klinara.android.services.crm.NotesService
import com.klinara.android.services.crm.TimelineEntry
import com.klinara.android.services.crm.TimelineKind
import com.klinara.android.services.crm.TimelineQuery
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CustomerRecordUiState(
    val notes: Loadable<List<CustomerNote>> = Loadable.Loading,
    /** Zaman çizelgesi BİRİKİMLİDİR — `loadMore` üstüne ekler. */
    val timeline: Loadable<List<TimelineEntry>> = Loadable.Loading,
    val kinds: Set<TimelineKind> = emptySet(),
    val isLoadingMore: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    private val cursor: String? = null,
) {
    val canLoadMore: Boolean get() = cursor != null && !isLoadingMore

    val isFiltered: Boolean get() = kinds.isNotEmpty()

    internal val nextCursor: String? get() = cursor
}

/**
 * Müşteri kartının KAYIT verisi — notlar ve zaman çizelgesi.
 *
 * **Kartla doğar, kartla ölür.** `CustomerListViewModel` oturum ömürlü ve liste
 * kapsamlı; notu oraya koymak, açılmış her müşterinin **sağlık verisini** oturum
 * boyunca bellekte tutmak olurdu (§5.2, §7.9).
 *
 * [canReadMedical] ekranın çizim kararı için taşınıyor; **güvenlik sınırı değil** —
 * sunucu klinik notları sorgudan zaten eliyor. İstemcideki değeri, "yok" ile
 * "göremiyorum"u ayırt eden metni yazabilmek için gerekiyor.
 */
class CustomerRecordViewModel(
    private val notesService: NotesService,
    private val customerId: String,
    val canReadMedical: Boolean,
    val canWriteMedical: Boolean,
) : ViewModel() {
    private val _state = MutableStateFlow(CustomerRecordUiState())
    val state: StateFlow<CustomerRecordUiState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            // İkisi PARALEL: not gelmezken çizelgenin de beklemesi için sebep yok.
            val notes = async { Loadable.of { notesService.notes(customerId) } }
            val timeline = async { Loadable.of { notesService.timeline(customerId, TimelineQuery()) } }

            _state.update { current ->
                val page = timeline.await()
                current.copy(
                    notes = notes.await(),
                    timeline = page.map { it.data },
                    cursor = page.valueOrNull?.pageInfo?.nextCursor,
                )
            }
        }
    }

    /**
     * Filtre değişince çizelge **BAŞTAN** yüklenir, üstüne eklenmez.
     *
     * Yeni filtre altında eskiyi biriktirmek, iki farklı sorgunun sonucunu tek listede
     * karıştırmak olurdu.
     */
    fun applyFilter(kinds: Set<TimelineKind>) {
        if (kinds == _state.value.kinds) return
        _state.update { it.copy(kinds = kinds, timeline = Loadable.Loading, cursor = null) }
        viewModelScope.launch {
            val page = Loadable.of { notesService.timeline(customerId, TimelineQuery(kinds = kinds)) }
            _state.update {
                it.copy(timeline = page.map { result -> result.data }, cursor = page.valueOrNull?.pageInfo?.nextCursor)
            }
        }
    }

    fun clearFilter() = applyFilter(emptySet())

    fun loadMore() {
        val current = _state.value
        if (!current.canLoadMore) return
        val cursor = current.nextCursor ?: return

        _state.update { it.copy(isLoadingMore = true) }
        viewModelScope.launch {
            val query = TimelineQuery(cursor = cursor, kinds = current.kinds)
            when (val page = Loadable.of { notesService.timeline(customerId, query) }) {
                is Loadable.Loaded ->
                    _state.update {
                        it.copy(
                            timeline = Loadable.Loaded((it.timeline.valueOrNull ?: emptyList()) + page.value.data),
                            cursor = page.value.pageInfo.nextCursor,
                            isLoadingMore = false,
                        )
                    }
                // İmleç korunur; yüklenmiş çizelge düşmez.
                else -> _state.update { it.copy(isLoadingMore = false) }
            }
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun createNote(
        body: String,
        kind: CustomerNoteKind,
        customerVisible: Boolean,
    ) = mutate { notesService.create(customerId, body, kind, customerVisible = customerVisible) }

    /**
     * Notu günceller.
     *
     * [openedVersion] notun **açıldığı andaki** sürümdür; store'un güncel sürümünü
     * göndermek kilidi etkisiz kılardı.
     */
    fun updateNote(
        id: String,
        openedVersion: Int,
        body: String,
        kind: CustomerNoteKind,
        customerVisible: Boolean,
    ) = mutate { notesService.update(id, openedVersion, body, kind, customerVisible) }

    fun deleteNote(id: String) = mutate { notesService.delete(id) }

    suspend fun revisions(noteId: String): Result<List<com.klinara.android.services.crm.CustomerNoteRevision>> =
        runCatching { notesService.revisions(noteId) }

    fun note(id: String): CustomerNote? = _state.value.notes.valueOrNull?.firstOrNull { it.id == id }

    /**
     * Yazma sonrası **not listesi VE çizelge** birlikte tazelenir.
     *
     * Bir not hem nottur hem zaman çizelgesi olayı; yalnız birini tazelemek iki
     * tutarsız liste bırakırdı.
     */
    private fun mutate(block: suspend () -> Unit) {
        if (_state.value.isSaving) return
        _state.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                block()
                val kinds = _state.value.kinds
                val notes = async { Loadable.of { notesService.notes(customerId) } }
                val timeline = async { Loadable.of { notesService.timeline(customerId, TimelineQuery(kinds = kinds)) } }
                val page = timeline.await()
                _state.update {
                    it.copy(
                        isSaving = false,
                        notes = notes.await(),
                        timeline = page.map { result -> result.data },
                        cursor = page.valueOrNull?.pageInfo?.nextCursor,
                    )
                }
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
            }
        }
    }

    private fun <T, R> Loadable<T>.map(transform: (T) -> R): Loadable<R> =
        when (this) {
            is Loadable.Loaded -> Loadable.Loaded(transform(value))
            is Loadable.Failed -> this
            Loadable.Loading -> Loadable.Loading
        }

    companion object {
        fun factory(
            container: ServiceContainer,
            customerId: String,
            canReadMedical: Boolean,
            canWriteMedical: Boolean,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    CustomerRecordViewModel(container.notes, customerId, canReadMedical, canWriteMedical) as T
            }
    }
}
