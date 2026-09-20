package com.klinara.android.features.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.Message
import com.klinara.android.services.notifications.MessageFilter
import com.klinara.android.services.notifications.MessageStatus
import com.klinara.android.services.notifications.MessagesService
import com.klinara.android.services.notifications.NotificationEvent
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant

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

/** Bir gün başlığı ve altındaki mesajlar. */
data class MessageDayGroup(
    /** Şube saatinde günün başlangıcı — sıralama ve kimlik. */
    val day: Instant,
    val title: String,
    val messages: List<Message>,
)

/**
 * Yüklenmiş satırlardan çıkarılan sayaçlar.
 *
 * **Kapsamı yüklenmiş sayfalardır**, tüm günlük değil: sunucuda sayaç ucu yok ve açmıyoruz
 * (Kural 1). Ekran bu yüzden kapsamı yazıyla söyler — yanlış bir toplam göstermektense neyin
 * sayıldığını söylemek.
 */
data class MessageLogSummary(
    val total: Int = 0,
    val failed: Int = 0,
    val skipped: Int = 0,
) {
    companion object {
        fun of(messages: List<Message>): MessageLogSummary =
            MessageLogSummary(
                total = messages.size,
                failed = messages.count { it.status == MessageStatus.Failed },
                skipped = messages.count { it.status == MessageStatus.Skipped },
            )
    }
}

data class MessageLogUiState(
    val status: MessageStatusFilter = MessageStatusFilter.All,
    val event: NotificationEvent? = null,
    val messages: Loadable<List<Message>> = Loadable.Loading,
    val nextCursor: String? = null,
    val isLoadingMore: Boolean = false,
    /** Sonraki sayfa düştü — satırlar KORUNUR, listenin sonunda "Tekrar dene" çizilir. */
    val loadMoreError: String? = null,
) {
    /**
     * **Kanal süzgeci yok.** Klinik müşterisiyle yalnız WhatsApp üzerinden yazışıyor; tek
     * seçenekli bir süzgeç listeden fazla yer tutan bir yanıltma olurdu. Alan modelde duruyor
     * (uç hâlâ destekliyor) ama ekran onu set etmiyor: geçmişteki e-posta kayıtları günlükte
     * görünmeye devam etsin.
     */
    val filter: MessageFilter
        get() = MessageFilter(event = event, status = status.value)

    val rows: List<Message> get() = messages.valueOrNull.orEmpty()

    val summary: MessageLogSummary get() = MessageLogSummary.of(rows)

    /**
     * Güne göre gruplanmış satırlar — sunucu zaten en yeniden eskiye sıralı döndürüyor, bu
     * yüzden görülme sırası korunur ve yeniden sıralanmaz.
     */
    fun groups(clock: BranchClock): List<MessageDayGroup> =
        rows
            .groupBy { clock.startOfDay(it.createdAt) }
            .map { (day, messages) -> MessageDayGroup(day, clock.relativeDayLabel(day), messages) }
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

    /** Özet şeridinden gelen "seçiliyse kaldır" davranışı da buradan geçer. */
    fun toggleStatus(status: MessageStatusFilter) =
        applyIfChanged { it.copy(status = if (it.status == status) MessageStatusFilter.All else status) }

    fun clearFilters() = applyIfChanged { it.copy(status = MessageStatusFilter.All, event = null) }

    /** "Tekrar dene": hatayı temizler ve aynı sayfayı yeniden ister. */
    fun retryLoadMore() {
        _state.update { it.copy(loadMoreError = null) }
        loadMore()
    }

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
