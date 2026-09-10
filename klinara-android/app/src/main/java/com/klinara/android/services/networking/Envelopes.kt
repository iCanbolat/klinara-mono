package com.klinara.android.services.networking

import kotlinx.serialization.Serializable

/** `{ "data": [...] }` — sunucunun liste zarfı. */
@Serializable
data class ListEnvelope<T>(val data: List<T> = emptyList())

/** İmleç tabanlı sayfalama bilgisi. */
@Serializable
data class PageInfo(
    val nextCursor: String? = null,
    val hasMore: Boolean = false,
)

/** Sayfalanmış liste yanıtı. */
@Serializable
data class Page<T>(
    val data: List<T> = emptyList(),
    val pageInfo: PageInfo = PageInfo(),
) {
    companion object {
        fun <T> empty() = Page<T>(emptyList(), PageInfo())
    }
}

/** Gövdesiz 2xx yanıtları için. Çözümleme hiç denenmez. */
@Serializable
object EmptyResponse
