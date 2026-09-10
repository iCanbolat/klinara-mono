package com.klinara.android.services.networking

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.mutablePreferencesOf
import com.klinara.android.services.auth.AuthTokens
import com.klinara.android.services.auth.InMemorySessionCipher
import com.klinara.android.services.auth.TokenStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.HttpUrl

/**
 * Bellek içi DataStore. Gerçek `PreferenceDataStoreFactory` bir dosya ve bir
 * `CoroutineScope` ister; birim testinde ikisi de gürültü.
 */
internal class FakePreferencesDataStore : DataStore<Preferences> {
    private val state = MutableStateFlow<Preferences>(emptyPreferences())
    private val writeLock = Mutex()

    override val data: Flow<Preferences> = state.asStateFlow()

    override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences): Preferences =
        writeLock.withLock {
            val next = transform(state.value)
            state.value = next
            next
        }
}

internal fun testTokenStore(
    cipher: InMemorySessionCipher = InMemorySessionCipher(),
    clock: java.time.Clock = java.time.Clock.systemUTC(),
): TokenStore = TokenStore(FakePreferencesDataStore(), cipher, clock)

internal fun tokens(
    access: String,
    refresh: String = "refresh-1",
    expiresIn: Long = 900,
) = AuthTokens(accessToken = access, refreshToken = refresh, expiresIn = expiresIn)

/** `problem+json` gövdesi kurmak için küçük yardımcı. */
internal fun problemJson(
    code: String,
    status: Int,
    title: String = "Hata",
    detail: String? = null,
    errors: String? = null,
): String =
    buildString {
        append("""{"code":"$code","title":"$title","status":$status""")
        detail?.let { append(""","detail":"$it"""") }
        errors?.let { append(""","errors":$it""") }
        append("}")
    }

internal fun HttpUrl.withApiV1(): HttpUrl = newBuilder().addPathSegments("api/v1/").build()

internal val UNUSED_PREFERENCES: Preferences = mutablePreferencesOf()
