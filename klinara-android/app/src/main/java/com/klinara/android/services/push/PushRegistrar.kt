package com.klinara.android.services.push

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.klinara.android.BuildConfig
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Push yaşam döngüsünün tek sahibi — iOS `PushCoordinator` paritesi.
 *
 * FCM anahtarı ve oturum farklı zamanlarda hazır olur; kayıt ikisi birden elde olunca
 * yapılır. Firebase `google-services.json` ile DEĞİL, `local.properties`'teki dört
 * değerle elle kurulur: dosya yokken derleme kırılmasın ve debug/release ayrı
 * projelere bakabilsin. Değerler boşsa push sessizce kapalı kalır.
 */
object PushRegistrar {
    private const val TAG = "KlinaraPush"

    @Volatile private var service: PushService? = null

    @Volatile private var registeredToken: String? = null

    /** Uygulama açılışında bir kez. */
    fun initialize(context: Context) {
        PushChannels.ensure(context)
        if (!isConfigured || FirebaseApp.getApps(context).isNotEmpty()) return
        val options =
            FirebaseOptions
                .Builder()
                .setApplicationId(BuildConfig.KLINARA_FIREBASE_APP_ID)
                .setApiKey(BuildConfig.KLINARA_FIREBASE_API_KEY)
                .setProjectId(BuildConfig.KLINARA_FIREBASE_PROJECT_ID)
                .setGcmSenderId(BuildConfig.KLINARA_FIREBASE_SENDER_ID)
                .build()
        FirebaseApp.initializeApp(context, options)
    }

    val isConfigured: Boolean
        get() =
            BuildConfig.KLINARA_FIREBASE_APP_ID.isNotBlank() &&
                BuildConfig.KLINARA_FIREBASE_API_KEY.isNotBlank() &&
                BuildConfig.KLINARA_FIREBASE_PROJECT_ID.isNotBlank() &&
                BuildConfig.KLINARA_FIREBASE_SENDER_ID.isNotBlank()

    /** Oturum açıldı (bildirim izni istendikten sonra). */
    suspend fun activate(service: PushService) {
        this.service = service
        registeredToken = null
        if (!isConfigured) return
        val token = currentToken() ?: return
        register(token)
    }

    /** Çıkıştan ÖNCE — silme isteği hâlâ geçerli token'la gitmeli. */
    suspend fun deactivate() {
        val current = service ?: return
        service = null
        registeredToken = null
        try {
            current.unregister()
        } catch (_: ApiError) {
            // Oturum zaten düşmüş olabilir; sunucu iptal edilen oturuma göndermiyor.
        }
    }

    /** FCM anahtarı yenilendi (`onNewToken`). */
    suspend fun onNewToken(token: String) = register(token)

    private suspend fun register(token: String) {
        val current = service ?: return
        if (registeredToken == token) return
        try {
            current.register(token)
            registeredToken = token
        } catch (error: ApiError) {
            // Bir sonraki açılışta yeniden denenir; push bir yan kanal.
            Log.w(TAG, "Push kaydı başarısız: ${error.javaClass.simpleName}")
        }
    }

    private suspend fun currentToken(): String? =
        suspendCancellableCoroutine { continuation ->
            FirebaseMessaging
                .getInstance()
                .token
                .addOnCompleteListener { task ->
                    continuation.resume(if (task.isSuccessful) task.result else null)
                }
        }
}
