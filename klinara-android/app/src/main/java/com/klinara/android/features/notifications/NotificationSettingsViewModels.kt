package com.klinara.android.features.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.BranchReminderSettings
import com.klinara.android.services.notifications.NotificationEvent
import com.klinara.android.services.notifications.NotificationEventCatalog
import com.klinara.android.services.notifications.NotificationPreference
import com.klinara.android.services.notifications.NotificationTemplate
import com.klinara.android.services.notifications.NotificationsService
import com.klinara.android.services.notifications.ReminderSettingsUpdate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Şablon listesinin satırı. [isMissing] — sunucunun listesinde HİÇ olmayan (olay, kanal) çifti.
 *
 * **iOS'tan sapma:** sunucu yalnız kod varsayılanı olan kanalları listeliyor ve varsayılanların
 * çoğu SMS + e-posta; randevu hatırlatmasının WhatsApp eşlemesi (Meta template adı) listede hiç
 * görünmüyor ve iOS'ta oluşturulamıyor. Olayın kataloğundaki eksik kanallar burada "Şablon yok"
 * satırı olarak çiziliyor; kaydetmek aynı `PUT` ile kiracı satırı açıyor — yeni uç YOK.
 */
data class TemplateRow(
    val template: NotificationTemplate,
    val isMissing: Boolean,
)

data class TemplateGroup(
    val event: NotificationEvent,
    val rows: List<TemplateRow>,
)

/** Şablon listesi — editörle PAYLAŞILIR (sahibi liste hedefinin geri yığını girdisi). */
class NotificationTemplatesViewModel(
    private val service: NotificationsService,
) : ViewModel() {
    private val _templates = MutableStateFlow<Loadable<List<TemplateGroup>>>(Loadable.Loading)
    val templates: StateFlow<Loadable<List<TemplateGroup>>> = _templates.asStateFlow()

    fun load() {
        viewModelScope.launch { _templates.value = Loadable.of { groups(service.templates()) } }
    }

    fun row(rowId: String): TemplateRow? =
        _templates.value.valueOrNull
            ?.flatMap { it.rows }
            ?.firstOrNull { it.template.rowId == rowId }

    companion object {
        /**
         * Olaya göre gruplu (kanal kanal düz bir liste "randevu hatırlatması hangi metinle gidiyor?"
         * sorusunu üç satıra bölerdi); grup içinde kanal sırası kataloğunki, eksikler dahil.
         */
        fun groups(templates: List<NotificationTemplate>): List<TemplateGroup> =
            NotificationEvent.selectable.mapNotNull { event ->
                val present = templates.filter { it.event == event }
                val missing =
                    NotificationEventCatalog
                        .channels(event)
                        .filter { channel -> present.none { it.channel == channel } }
                        .map { channel ->
                            TemplateRow(
                                NotificationTemplate(
                                    event = event,
                                    channel = channel,
                                    kind = NotificationEventCatalog.kind(event),
                                    isDefault = true,
                                ),
                                isMissing = true,
                            )
                        }
                val order = NotificationEventCatalog.channels(event)
                val rows =
                    (present.map { TemplateRow(it, isMissing = false) } + missing)
                        .sortedBy { row -> order.indexOf(row.template.channel).takeIf { it >= 0 } ?: order.size }
                rows.takeIf { it.isNotEmpty() }?.let { TemplateGroup(event, it) }
            }

        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    NotificationTemplatesViewModel(container.notifications) as T
            }
    }
}

data class TemplateEditorUiState(
    val form: NotificationTemplateForm,
    val isSaving: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val saved: Boolean = false,
)

class NotificationTemplateEditorViewModel(
    private val service: NotificationsService,
    template: NotificationTemplate,
) : ViewModel() {
    private val _state = MutableStateFlow(TemplateEditorUiState(NotificationTemplateForm.editing(template)))
    val state: StateFlow<TemplateEditorUiState> = _state.asStateFlow()

    fun update(transform: (NotificationTemplateForm) -> NotificationTemplateForm) =
        _state.update { it.copy(form = transform(it.form), error = null, fieldErrors = emptyMap()) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun save() {
        val current = _state.value
        if (current.isSaving || !current.form.isValid) return
        _state.update { it.copy(isSaving = true, error = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                service.upsertTemplate(current.form.input())
                _state.update { it.copy(isSaving = false, saved = true) }
            } catch (error: ApiError) {
                _state.update { it.failed(error) }
            }
        }
    }

    private fun TemplateEditorUiState.failed(error: ApiError) =
        copy(
            isSaving = false,
            error = if (error.isFieldScoped) null else error.displayMessage,
            fieldErrors = error.fieldErrors,
        )

    companion object {
        fun factory(
            container: ServiceContainer,
            template: NotificationTemplate,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    NotificationTemplateEditorViewModel(container.notifications, template) as T
            }
    }
}

/** Tercih listesi — editörle PAYLAŞILIR. */
class NotificationPreferencesViewModel(
    private val service: NotificationsService,
) : ViewModel() {
    private val _preferences = MutableStateFlow<Loadable<List<NotificationPreference>>>(Loadable.Loading)
    val preferences: StateFlow<Loadable<List<NotificationPreference>>> = _preferences.asStateFlow()

    fun load() {
        viewModelScope.launch { _preferences.value = Loadable.of { service.preferences() } }
    }

    fun preference(rowId: String): NotificationPreference? =
        _preferences.value.valueOrNull?.firstOrNull { it.rowId == rowId }

    companion object {
        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    NotificationPreferencesViewModel(container.notifications) as T
            }
    }
}

data class PreferenceEditorUiState(
    val draft: PreferenceDraft,
    val isSaving: Boolean = false,
    val error: String? = null,
    val saved: Boolean = false,
)

class NotificationPreferenceEditorViewModel(
    private val service: NotificationsService,
    preference: NotificationPreference,
    private val activeBranchId: String?,
) : ViewModel() {
    private val _state = MutableStateFlow(PreferenceEditorUiState(PreferenceDraft.editing(preference)))
    val state: StateFlow<PreferenceEditorUiState> = _state.asStateFlow()

    fun update(transform: (PreferenceDraft) -> PreferenceDraft) =
        _state.update { it.copy(draft = transform(it.draft), error = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun save() {
        val current = _state.value
        if (current.isSaving || !current.draft.isValid) return
        _state.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                service.upsertPreference(current.draft.input(activeBranchId))
                _state.update { it.copy(isSaving = false, saved = true) }
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            preference: NotificationPreference,
            activeBranchId: String?,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    NotificationPreferenceEditorViewModel(container.notifications, preference, activeBranchId) as T
            }
    }
}

data class ReminderSettingsUiState(
    val settings: Loadable<BranchReminderSettings> = Loadable.Loading,
    val draft: ReminderDraft? = null,
    val newHourText: String = "",
    val isSaving: Boolean = false,
    val confirmReset: Boolean = false,
    val error: String? = null,
) {
    val newHour: Int? get() = newHourText.trim().toIntOrNull()
}

/**
 * Şube hatırlatma ayarı (A8.2) — iOS `ReminderSettingsView` + store dilimi.
 *
 * Yerel taslak + tek "Kaydet": saat başına otomatik kayıt, yarım kalan bir istekte listenin
 * geri kalanını belirsiz bırakırdı. Kayıttan sonra taslak **yanıttan** yeniden kurulur —
 * `isBranchOverride` sunucunun kararı.
 */
class ReminderSettingsViewModel(
    private val service: NotificationsService,
    private val branchId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(ReminderSettingsUiState())
    val state: StateFlow<ReminderSettingsUiState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            val result = Loadable.of { service.reminderSettings(branchId) }
            _state.update { it.copy(settings = result, draft = result.valueOrNull?.let(ReminderDraft::from)) }
        }
    }

    fun setNewHourText(text: String) = _state.update { it.copy(newHourText = text.filter(Char::isDigit)) }

    fun addHour() =
        _state.update { state ->
            val draft = state.draft ?: return@update state
            if (!draft.canAdd(state.newHour)) return@update state
            state.copy(draft = draft.adding(state.newHour!!), newHourText = "")
        }

    fun updateDraft(transform: (ReminderDraft) -> ReminderDraft) =
        _state.update { state -> state.copy(draft = state.draft?.let(transform), error = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun askReset() = _state.update { it.copy(confirmReset = true) }

    fun cancelReset() = _state.update { it.copy(confirmReset = false) }

    fun save() {
        val draft = _state.value.draft ?: return
        if (!draft.isValid) return
        send(draft.update() ?: return)
    }

    /** Boş dizi override'ı KALDIRIR — onay diyaloğundan sonra, tek açık yol bu. */
    fun confirmReset() {
        _state.update { it.copy(confirmReset = false) }
        send(ReminderSettingsUpdate.RESET_TO_TENANT)
    }

    private fun send(update: ReminderSettingsUpdate) {
        if (_state.value.isSaving) return
        _state.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                val saved = service.updateReminderSettings(branchId, update)
                _state.update {
                    it.copy(settings = Loadable.Loaded(saved), draft = ReminderDraft.from(saved), isSaving = false)
                }
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            branchId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    ReminderSettingsViewModel(container.notifications, branchId) as T
            }
    }
}
