package com.klinara.android.services.auth

import android.util.Log
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.klinara.android.services.networking.KlinaraJson
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerializationException
import java.security.GeneralSecurityException
import java.util.Base64
import java.time.Clock
import java.time.Instant

/**
 * Şifreli oturum deposu.
 *
 * iOS Keychain'in iki niteliği taşınır:
 * - `AfterFirstUnlock` → Keystore anahtarı kullanıcı kimlik doğrulaması İSTEMEZ,
 *   böylece arka planda token yenileme çalışabilir.
 * - `ThisDeviceOnly` → `allowBackup=false` **ve** `dataExtractionRules`'da hem
 *   `<cloud-backup>` hem `<device-transfer>` dışlaması.
 *
 * **Eşzamanlılık:** iOS Keychain I/O'yu kilidin dışında yapar; burada DataStore zaten
 * suspend ve serileştirilmiş olduğu için tek bir [Mutex] cache + I/O'yu birlikte
 * korur. `Mutex` REENTRANT DEĞİLDİR — kilidi tutan bir fonksiyon kilit alan başka
 * bir fonksiyonu çağırmamalı.
 */
class TokenStore internal constructor(
    private val dataStore: DataStore<Preferences>,
    private val cipher: SessionCipher,
    private val clock: Clock = Clock.systemUTC(),
) {
    private val mutex = Mutex()

    /**
     * `HeaderInterceptor.intercept` BLOKLAYICI olduğu için suspend olmayan okuma şart.
     * [warmUp] ile ısıtılır; soğuksa istek `Authorization`sız gider, 401 olur ve
     * suspend edebilen `Authenticator` devreye girer. Bu düşüş yolu test edilmiştir.
     */
    @Volatile
    private var cached: PersistedSession? = null

    @Volatile
    private var loaded: Boolean = false

    // --- Suspend olmayan okumalar (interceptor için) ---

    fun cachedAccessToken(): String? = cached?.accessToken

    fun cachedBranchId(): String? = cached?.branchId

    // --- Suspend okumalar ---

    suspend fun hasSession(): Boolean = load() != null

    suspend fun accessToken(): String? = load()?.accessToken

    suspend fun refreshToken(): String? = load()?.refreshToken

    suspend fun tenantId(): String? = load()?.tenantId

    suspend fun branchId(): String? = load()?.branchId

    /** Süresine 60 saniyeden az kaldıysa yenilenmeli — iOS ile aynı pencere. */
    suspend fun needsRefresh(): Boolean {
        val session = load() ?: return false
        return session.expiresAt.isBefore(Instant.now(clock).plusSeconds(REFRESH_WINDOW_SECONDS))
    }

    /** Uygulama açılışında bir kez: interceptor'ın senkron okuması için cache'i ısıtır. */
    suspend fun warmUp() {
        load()
    }

    // --- Yazmalar ---

    /**
     * Yeni token çiftini yazar. Mevcut [PersistedSession.branchId] ve
     * [PersistedSession.tenantId] KORUNUR — yenileme sonrası şube kapsamının
     * sıfırlanması, kullanıcının sebepsiz yere şube seçim ekranına düşmesi demektir.
     */
    suspend fun save(
        tokens: AuthTokens,
        tenantId: String? = null,
    ) {
        mutex.withLock {
            val previous = readLocked()
            writeLocked(
                PersistedSession(
                    accessToken = tokens.accessToken,
                    refreshToken = tokens.refreshToken,
                    expiresAt = Instant.now(clock).plusSeconds(tokens.expiresIn),
                    tenantId = tenantId ?: previous?.tenantId,
                    branchId = previous?.branchId,
                ),
            )
        }
    }

    suspend fun setBranch(branchId: String?) {
        mutex.withLock {
            val current = readLocked() ?: return@withLock
            writeLocked(current.copy(branchId = branchId))
        }
    }

    suspend fun setTenant(tenantId: String?) {
        mutex.withLock {
            val current = readLocked() ?: return@withLock
            writeLocked(current.copy(tenantId = tenantId))
        }
    }

    suspend fun clear() {
        mutex.withLock { resetLocked() }
    }

    // --- İç işleyiş ---

    private suspend fun load(): PersistedSession? =
        mutex.withLock {
            readLocked()
        }

    /**
     * **Kural: çözememek çıkış yapmak demektir, asla çökmek değil.**
     *
     * Cihaz geri yükleme, OEM firmware hatası ya da `.debug`/release çakışması
     * Keystore anahtarını geçersizleştirebilir. Bu istisnalar yayılsaydı kullanıcı
     * uygulamayı bir daha hiç açamazdı; "çıkış yapılmış" tek kabul edilebilir davranış.
     */
    private suspend fun readLocked(): PersistedSession? {
        if (loaded) return cached

        val encoded = dataStore.data.first()[SESSION_BLOB]
        if (encoded == null) {
            loaded = true
            return null
        }

        return try {
            val plain = cipher.open(BASE64_DECODER.decode(encoded))
            KlinaraJson.decodeFromString<PersistedSession>(plain.decodeToString()).also {
                cached = it
                loaded = true
            }
        } catch (e: GeneralSecurityException) {
            // KeyPermanentlyInvalidatedException, AEADBadTagException,
            // UnrecoverableKeyException — hepsi aynı anlama gelir: blob artık açılamaz.
            // Log'a YALNIZ sınıf adı; içerik asla.
            Log.w(TAG, "Oturum çözülemedi, sıfırlanıyor: ${e.javaClass.simpleName}")
            resetLocked()
            null
        } catch (e: SerializationException) {
            Log.w(TAG, "Oturum şeması uyuşmadı, sıfırlanıyor: ${e.javaClass.simpleName}")
            resetLocked()
            null
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "Oturum blob'u bozuk, sıfırlanıyor: ${e.javaClass.simpleName}")
            resetLocked()
            null
        }
    }

    private suspend fun writeLocked(session: PersistedSession) {
        val sealed = cipher.seal(KlinaraJson.encodeToString(session).encodeToByteArray())
        dataStore.edit {
            it[SESSION_BLOB] = BASE64_ENCODER.encodeToString(sealed)
            it[KEY_VERSION] = CURRENT_KEY_VERSION
        }
        cached = session
        loaded = true
    }

    private suspend fun resetLocked() {
        runCatching { cipher.destroy() }
        dataStore.edit {
            it.remove(SESSION_BLOB)
            it.remove(KEY_VERSION)
        }
        cached = null
        loaded = true
    }

    private companion object {
        const val TAG = "KlinaraTokenStore"
        const val REFRESH_WINDOW_SECONDS = 60L

        /** Gelecekte anahtar rotasyonu tahmin edilmesin, tespit edilsin. */
        const val CURRENT_KEY_VERSION = 1

        // java.util.Base64 (API 26+, tam minSdk tabanımız): android.util.Base64
        // JVM birim testlerinde yok ve Base64'ün GERÇEKTEN çalışması testin
        // anlamı için şart — mühürle/aç gidiş-dönüşü doğrulanamazdı.
        val BASE64_ENCODER: Base64.Encoder = Base64.getEncoder().withoutPadding()
        val BASE64_DECODER: Base64.Decoder = Base64.getDecoder()

        val SESSION_BLOB = stringPreferencesKey("session_blob")
        val KEY_VERSION = intPreferencesKey("key_version")
    }
}
