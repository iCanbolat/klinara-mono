package com.klinara.android.services.networking

/** Başlık adları tek yerde — bir uçta yanlış yazılması mümkün olmasın. */
internal object KlinaraHeaders {
    const val ACCEPT = "Accept"
    const val AUTHORIZATION = "Authorization"
    const val BRANCH_ID = "X-Branch-Id"
    const val REQUEST_ID = "X-Request-Id"
    const val IDEMPOTENCY_KEY = "Idempotency-Key"
    const val IF_MATCH = "If-Match"
    const val CONTENT_TYPE = "Content-Type"
    const val RETRY_AFTER = "Retry-After"

    const val APPLICATION_JSON = "application/json"
}
