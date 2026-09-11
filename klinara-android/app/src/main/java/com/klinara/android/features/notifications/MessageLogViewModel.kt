package com.klinara.android.features.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.Message
import com.klinara.android.services.notifications.MessageFilter
import com.klinara.android.services.notifications.MessageStatus
import com.klinara.android.services.notifications.MessagesService
import com.klinara.android.services.notifications.NotificationChannel
import com.klinara.android.services.notifications.NotificationEvent
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Durum süzgeci. Seçicide dört seçenek var; "Gönderilmedi" kesiliyordu, iOS gibi "Atlandı".
 *
 * **"Ulaştı" yalnız `delivered`**: sunucu tek bir `status` alıyor, okunan (`read`) mesajlar bu
 * süzgeçte görünmez. Ekran bunu dipnotla söyler (iOS söylemiyor).
 */
enum class MessageStatusFilter(
    val title: String,
    val value: MessageStatus?,
) {
    All("Tümü", null),
    Failed("Başarısız", MessageStatus.Failed),
    Skipped("Atlandı", MessageStatus.Skipped),
    Delivered("Ulaştı", MessageStatus.Delivered),
}

/** Yalnız gerçekten gönderim yapan kanallar: SMS ve push'un sağlayıcısı yok (Ek M), boş liste üretirlerdi. */
enum class MessageChannelFilter(
    val title: String,
    val value: NotificationChannel?,
) {
    All("Tüm kanallar", null),
    WhatsApp("WhatsApp", NotificationChannel.WhatsApp),
    Email("E-posta", NotificationChannel.Email),
}

data class MessageLogUiState(
    val status: MessageStatusFilter = MessageStatusFilter.All,
    val channel: MessageChannelFilter = MessageChannelFilter.All,
    val event: NotificationEvent? = null,
    val messages: Loadable<List<Message>> = Loadable.Loading,
    val nextCursor: String? = null,
    val isLoadingMore: Boolean = false,
    /** Sonraki sayfa düştü — satırlar KORUNUR, listenin sonunda "Tekrar dene" çizilir. */
    val loadMoreError: String? = null,
) {
    val filter: MessageFilter
        get() = MessageFilter(channel = channel.value, event = event, status = status.value)
}

/**
 * Mesaj günlüğü (A8.1) — iOS `MessageLogStore` paritesi.
 *
 * Süzgeç değişince **imleç sıfırlanır**: eski imleç yeni süzgeçte anlamsızdır ve taşınırsa
 * sayfa ortasından başlayan, sebebi görünmeyen bir liste üretir.
 *
 * **iOS'tan sapma:** sonraki sayfa hatası yutulmuyor. iOS'ta sessizce başarısız oluyor ve
 * sondaki spinner `onAppear`'ı bir daha tetiklemediği için sonsuza dek dönüyor; burada satırlar
 * korunur ve listenin sonunda bir "Tekrar dene" satırı çıkar.
 *
 * Sahibi günlük hedefinin geri yığını girdisi: detay ekranı mesajı buradan okur
 * ([message]) — `GET /messages/:id` yok ve yeni uç açılmaz (Kural 1).
 */
class MessageLogViewModel(
    private val service: MessagesService,
) : ViewModel() {
    private val _state = MutableStateFlow(MessageLogUiState())
    val state: StateFlow<MessageLogUiState> = _state.asStateFlow()

    private var loadJob: Job? = null
    private var pageJob: Job? = null

    /** İlk açılışta bir kez; editörden/detaydan dönüşte liste zaten elde. */
    fun loadIfNeeded() {
        if (_state.value.messages !is Loadable.Loaded) load()
    }

    fun load() {
        loadJob?.cancel()
        pageJob?.cancel()
        val filter = _state.value.filter
        _state.update {
            it.copy(messages = Loadable.Loading, nextCursor = null, isLoadingMore = false, loadMoreError = null)
        }
        loadJob =
            viewModelScope.launch {
                try {
                    val page = service.messages(filter = filter)
                    _state.update {
                        it.copy(messages = Loadable.Loaded(page.data), nextCursor = page.pageInfo.nextCursor)
                    }
                } catch (error: ApiError) {
                    _state.update { it.copy(messages = Loadable.failed(error)) }
                }
            }
    }

    fun loadMore() {
        val current = _state.value
        val cursor = current.nextCursor ?: return
        if (current.isLoadingMore || current.messages !is Loadable.Loaded) return
        val filter = current.filter
        _state.update { it.copy(isLoadingMore = true, loadMoreError = null) }
        pageJob =
            viewModelScope.launch {
                try {
                    val page = service.messages(cursor = cursor, filter = filter)
                    _state.update { state ->
                        val rows = state.messages.valueOrNull.orEmpty()
                        state.copy(
                            messages = Loadable.Loaded(rows + page.data),
                            nextCursor = page.pageInfo.nextCursor,
                            isLoadingMore = false,
                        )
                    }
                } catch (error: ApiError) {
                    // İmleç korunur: "Tekrar dene" aynı sayfayı ister.
                    _state.update { it.copy(isLoadingMore = false, loadMoreError = error.displayMessage) }
                }
            }
    }

    fun setStatus(status: MessageStatusFilter) = applyIfChanged { it.copy(status = status) }

    fun setChannel(channel: MessageChannelFilter) = applyIfChanged { it.copy(channel = channel) }

    /** Seçili çipe tekrar dokunmak süzgeci kaldırır. */
    fun toggleEvent(event: NotificationEvent) =
        applyIfChanged { it.copy(event = if (it.event == event) null else event) }

    fun message(id: String): Message? = _state.value.messages.valueOrNull?.firstOrNull { it.id == id }

    /** Aynı süzgeç yeniden seçilirse yeniden YÜKLENMEZ (iOS `applyFilter` guard'ı). */
    private fun applyIfChanged(transform: (MessageLogUiState) -> MessageLogUiState) {
        val before = _state.value
        val after = transform(before)
        if (after.filter == before.filter) return
        _state.value = after
        load()
    }

    companion object {
        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    MessageLogViewModel(container.messages) as T
            }
    }
}
