package com.klinara.android.features.conversations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.conversations.Conversation
import com.klinara.android.services.conversations.ConversationFilter
import com.klinara.android.services.conversations.ConversationsService
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ConversationListUiState(
    val filter: ConversationFilter = ConversationFilter.Open,
    val conversations: Loadable<List<Conversation>> = Loadable.Loading,
    val cursor: String? = null,
    val isLoadingMore: Boolean = false,
    val loadMoreError: String? = null,
)

/**
 * Sohbet listesi — iOS `ConversationListStore` paritesi.
 *
 * Süzgeç değişince cursor SIFIRLANIR: eski cursor yeni süzgeçte anlamsız. Yenilemede (dönüş,
 * aşağı çekme) yüklü liste korunur; hata yalnız ilk yüklemede ekranı kaplar.
 */
class ConversationListViewModel(
    private val service: ConversationsService,
) : ViewModel() {
    private val _state = MutableStateFlow(ConversationListUiState())
    val state: StateFlow<ConversationListUiState> = _state.asStateFlow()

    fun load() {
        val filter = _state.value.filter
        viewModelScope.launch {
            try {
                val page = service.conversations(filter)
                _state.update {
                    if (it.filter != filter) {
                        it
                    } else {
                        it.copy(
                            conversations = Loadable.Loaded(page.data),
                            cursor = page.pageInfo.nextCursor.takeIf { page.pageInfo.hasMore },
                            loadMoreError = null,
                        )
                    }
                }
            } catch (error: ApiError) {
                _state.update {
                    val keep = it.filter != filter || it.conversations is Loadable.Loaded
                    if (keep) it else it.copy(conversations = Loadable.failed(error))
                }
            }
        }
    }

    fun loadMore() {
        val current = _state.value
        val cursor = current.cursor ?: return
        if (current.isLoadingMore || current.loadMoreError != null) return
        _state.update { it.copy(isLoadingMore = true) }
        viewModelScope.launch {
            try {
                val page = service.conversations(current.filter, cursor)
                _state.update {
                    val loaded = it.conversations.valueOrNull.orEmpty()
                    it.copy(
                        conversations = Loadable.Loaded(loaded + page.data),
                        cursor = page.pageInfo.nextCursor.takeIf { page.pageInfo.hasMore },
                        isLoadingMore = false,
                    )
                }
            } catch (error: ApiError) {
                _state.update { it.copy(isLoadingMore = false, loadMoreError = error.displayMessage) }
            }
        }
    }

    fun retryLoadMore() {
        _state.update { it.copy(loadMoreError = null) }
        loadMore()
    }

    fun setFilter(filter: ConversationFilter) {
        if (filter == _state.value.filter) return
        _state.update { ConversationListUiState(filter = filter) }
        load()
    }

    /** Akıştaki değişiklik listeye yansır; süzgece artık uymayan satır düşer. */
    fun update(conversation: Conversation) {
        _state.update { state ->
            val list = state.conversations.valueOrNull ?: return@update state
            val updated =
                if (state.filter.matches(conversation)) {
                    list.map { if (it.id == conversation.id) conversation else it }
                } else {
                    list.filterNot { it.id == conversation.id }
                }
            state.copy(conversations = Loadable.Loaded(updated))
        }
    }

    companion object {
        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    ConversationListViewModel(container.conversations) as T
            }
    }
}
