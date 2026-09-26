package com.klinara.android.features.conversations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.conversations.Conversation
import com.klinara.android.services.conversations.ConversationDetail
import com.klinara.android.services.conversations.ConversationMessage
import com.klinara.android.services.conversations.ConversationTemplateOption
import com.klinara.android.services.conversations.ConversationsService
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.coroutines.coroutineContext

data class ConversationThreadUiState(
    val detail: Loadable<ConversationDetail> = Loadable.Loading,
    val isSending: Boolean = false,
    val isUpdatingStatus: Boolean = false,
    /** Gönderim ya da durum değişikliği hatası — akışın üstünde. */
    val actionError: String? = null,
) {
    val conversation: Conversation? get() = detail.valueOrNull?.conversation

    /** Serbest metin yazılabilir mi: sohbet açık VE pencere açık. */
    val canCompose: Boolean get() = conversation?.let { !it.isClosed && it.windowOpen } == true

    /** Pencere kapalı ama sohbet açık — yalnız şablon gönderilebilir. */
    val needsTemplate: Boolean get() = conversation?.let { !it.isClosed && !it.windowOpen } == true
}

/** Şablon sayfasının durumu — ViewModel'de, ekran döndürmede kaybolmasın. */
data class TemplateSheetState(
    val options: Loadable<List<ConversationTemplateOption>> = Loadable.Loading,
    val selectedKey: String? = null,
    val values: List<String> = emptyList(),
    val showsMissing: Boolean = false,
    val isSending: Boolean = false,
    val error: String? = null,
) {
    val selected: ConversationTemplateOption? get() = options.valueOrNull?.firstOrNull { it.key == selectedKey }

    fun missing(index: Int): Boolean = showsMissing && values.getOrNull(index).isNullOrBlank()
}

/**
 * Tek sohbetin akışı — iOS `ConversationThreadStore` paritesi.
 *
 * Açık sohbet OKUNMUŞ sayılır. Yoklama [poll] ile yapılır ve ekranın yaşam döngüsüne bağlıdır
 * (`repeatOnLifecycle(STARTED)`): ekran görünmezken istek atılmaz.
 */
class ConversationThreadViewModel(
    private val service: ConversationsService,
    val conversationId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(ConversationThreadUiState())
    val state: StateFlow<ConversationThreadUiState> = _state.asStateFlow()

    private val _template = MutableStateFlow<TemplateSheetState?>(null)

    /** `null` → şablon sayfası kapalı. */
    val template: StateFlow<TemplateSheetState?> = _template.asStateFlow()

    fun load() {
        viewModelScope.launch { refresh() }
    }

    suspend fun refresh() {
        try {
            var result = service.conversation(conversationId)
            if (result.conversation.unread) {
                val read = result.conversation.copy(unread = false)
                result = result.copy(conversation = read)
                runCatching { service.markRead(conversationId) }
            }
            _state.update { it.copy(detail = Loadable.Loaded(result)) }
        } catch (error: ApiError) {
            // Yoklamadaki geçici hata yüklü akışı silmez.
            _state.update { if (it.detail is Loadable.Loaded) it else it.copy(detail = Loadable.failed(error)) }
        }
    }

    /** Görünür olduğu sürece periyodik yenileme; çağıran iptal edince durur. */
    suspend fun poll(intervalMillis: Long = POLL_MILLIS) {
        while (coroutineContext.isActive) {
            delay(intervalMillis)
            refresh()
        }
    }

    /** [onSent] yalnız mesaj kaydedildiyse çağrılır (Meta hatası da `failed` bir mesaj olarak kaydedilir). */
    fun send(
        body: String,
        onSent: () -> Unit = {},
    ) {
        val trimmed = body.trim()
        if (trimmed.isEmpty() || _state.value.isSending) return
        _state.update { it.copy(isSending = true, actionError = null) }
        viewModelScope.launch {
            try {
                append(service.send(conversationId, trimmed))
                _state.update { it.copy(isSending = false) }
                onSent()
            } catch (error: ApiError) {
                _state.update { it.copy(isSending = false, actionError = error.displayMessage) }
                // Pencere bu arada kapanmış olabilir: sunucunun görüşüne dön.
                if (error.code == ApiErrorCode.WHATSAPP_WINDOW_CLOSED) refresh()
            }
        }
    }

    fun setClosed(closed: Boolean) {
        _state.update { it.copy(isUpdatingStatus = true, actionError = null) }
        viewModelScope.launch {
            try {
                replace(service.setClosed(conversationId, closed))
                _state.update { it.copy(isUpdatingStatus = false) }
            } catch (error: ApiError) {
                _state.update { it.copy(isUpdatingStatus = false, actionError = error.displayMessage) }
            }
        }
    }

    fun linkCustomer(customerId: String) {
        viewModelScope.launch {
            try {
                replace(service.linkCustomer(conversationId, customerId))
                refresh()
            } catch (error: ApiError) {
                _state.update { it.copy(actionError = error.displayMessage) }
            }
        }
    }

    fun dismissError() = _state.update { it.copy(actionError = null) }

    // --- Şablon ---------------------------------------------------------------

    fun openTemplates() {
        _template.value = TemplateSheetState()
        viewModelScope.launch {
            try {
                val options = service.templateOptions(conversationId)
                val first = options.firstOrNull()
                _template.update {
                    it?.copy(
                        options = Loadable.Loaded(options),
                        selectedKey = first?.key,
                        values = first?.suggestedParameters.orEmpty(),
                    )
                }
            } catch (error: ApiError) {
                _template.update { it?.copy(options = Loadable.failed(error)) }
            }
        }
    }

    fun closeTemplates() {
        _template.value = null
    }

    fun chooseTemplate(key: String) =
        _template.update { sheet ->
            val option = sheet?.options?.valueOrNull?.firstOrNull { it.key == key } ?: return@update sheet
            sheet.copy(selectedKey = key, values = option.suggestedParameters, showsMissing = false, error = null)
        }

    fun setTemplateValue(
        index: Int,
        value: String,
    ) = _template.update { sheet ->
        sheet?.copy(values = sheet.values.toMutableList().also { if (index in it.indices) it[index] = value })
    }

    fun sendTemplate() {
        val sheet = _template.value ?: return
        val option = sheet.selected ?: return
        if (sheet.isSending) return
        if (!option.isComplete(sheet.values)) {
            _template.update { it?.copy(showsMissing = true) }
            return
        }
        _template.update { it?.copy(isSending = true, error = null) }
        viewModelScope.launch {
            try {
                append(
                    service.sendTemplate(
                        conversationId,
                        option.name,
                        option.language,
                        sheet.values.map(String::trim),
                    ),
                )
                _template.value = null
            } catch (error: ApiError) {
                _template.update { it?.copy(isSending = false, error = error.displayMessage) }
            }
        }
    }

    private fun append(message: ConversationMessage) {
        val detail = _state.value.detail.valueOrNull ?: return
        val conversation = detail.conversation.afterOutgoing(message)
        _state.update {
            it.copy(detail = Loadable.Loaded(ConversationDetail(conversation, detail.messages + message)))
        }
    }

    private fun replace(conversation: Conversation) {
        val detail = _state.value.detail.valueOrNull ?: return
        _state.update { it.copy(detail = Loadable.Loaded(detail.copy(conversation = conversation))) }
    }

    companion object {
        const val POLL_MILLIS = 5_000L

        fun factory(
            container: ServiceContainer,
            conversationId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    ConversationThreadViewModel(container.conversations, conversationId) as T
            }
    }
}
