package com.klinara.android.services.passkey

import android.app.Activity

/**
 * Passkey işleminin sonucu.
 *
 * Ayrımlar kullanıcıya ne söyleneceğini belirliyor ve bir tanesi kritik:
 * [Misconfigured] bir **geliştirme hatasıdır** ve kullanıcıya "cihazınız
 * desteklemiyor" DENMEMELİ — bu, çalışması gereken bir şeyi kullanıcının cihazının
 * suçu gibi göstermek olur (§6 A1.5).
 */
sealed interface PasskeyOutcome {
    /** Sunucuya olduğu gibi iletilecek WebAuthn yanıt JSON'ı. */
    data class Success(val responseJson: String) : PasskeyOutcome

    /** Kullanıcı sayfayı kapattı. Sessiz — hata gösterilmez. */
    data object Cancelled : PasskeyOutcome

    /** Kayıtlı passkey yok. Sessiz — parola yoluna düşülür. */
    data object NoCredential : PasskeyOutcome

    /** Cihazda/sağlayıcıda passkey desteği yok. */
    data object Unsupported : PasskeyOutcome

    /** RP ID / assetlinks uyuşmazlığı. GELİŞTİRME HATASI: ayrı log, ayrı mesaj. */
    data class Misconfigured(val diagnostic: String) : PasskeyOutcome

    data class Failed(val cause: Throwable) : PasskeyOutcome
}

/**
 * Credential Manager sarmalayıcısı.
 *
 * Arayüz **A1.1'de** konuyor ve dal derlenip test ediliyor ama uykuda kalıyor; A1.5
 * geldiğinde `CredentialManagerPasskeyService` yerine geçiyor ve **yönlendirme kodu hiç
 * değişmiyor**. Erteleme bu seam sayesinde bir söz değil, bir gerçek.
 *
 * `Activity` parametresi bilinçli: Credential Manager bir Activity bağlamı ister ve bu
 * ViewModel'e `Context` sızdırmanın en kolay yolu olurdu. ViewModel bunun yerine tek
 * atımlık bir efekt yayar, ekran servisi çağırır ve sonucu olay olarak geri besler.
 */
interface PasskeyService {
    fun isAvailable(): Boolean

    suspend fun assert(
        optionsJson: String,
        activity: Activity,
    ): PasskeyOutcome

    suspend fun create(
        optionsJson: String,
        activity: Activity,
    ): PasskeyOutcome
}

/**
 * A1.5 ertelendiği sürece geçerli uygulama.
 *
 * Erteleme gerekçesi: **bir WebAuthn RP ID asla bir IP adresi olamaz.** `10.0.2.2` ya da
 * `localhost` üzerinden passkey geliştirilemez; gerçek bir https konak ve orada
 * yayınlanmış `/.well-known/assetlinks.json` gerekir (ön koşul P3, sunucuda o uç henüz
 * yok). Bu, dokümandaki R1 riskinin eksik kalan yarısı.
 */
class UnavailablePasskeyService : PasskeyService {
    override fun isAvailable(): Boolean = false

    override suspend fun assert(
        optionsJson: String,
        activity: Activity,
    ): PasskeyOutcome = PasskeyOutcome.Unsupported

    override suspend fun create(
        optionsJson: String,
        activity: Activity,
    ): PasskeyOutcome = PasskeyOutcome.Unsupported
}
