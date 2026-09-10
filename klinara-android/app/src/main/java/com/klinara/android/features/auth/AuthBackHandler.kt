package com.klinara.android.features.auth

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable

/**
 * Giriş akışının geri tuşu davranışı.
 *
 * `NavHost` YOK — akış bir ağaç değil doğrusal bir durum makinesi (§5.3). Bu, geri
 * tuşunun **açıkça** ele alınması demektir; sessizce yığından pop etmek yok.
 *
 * | Adım | Geri ne yapar |
 * |---|---|
 * | `Launch`, `Identifier` | handler kurulmaz → sistem geri tuşu uygulamadan çıkar |
 * | `Password` | → `Identifier`, parolayı temizler |
 * | `Totp`, `BackupCode`, `TotpSetup` | challenge sıfırlanır → `Identifier` |
 * | `BackupCodesDisplay` | **yutulur** — kodlar bir kez gösterilir |
 * | `ForgotPasswordEmail` | → `Password` |
 * | `ForgotPasswordSent` | girdiler temizlenir → `Identifier` |
 * | `TenantSelect` | `logout()` |
 * | `BranchSelect` | **`logout()`** — token zaten diskte |
 * | `PhoneVerification` | **`logout()`** — token zaten diskte |
 * | `PasskeyEnrollOffer` | "Şimdi değil" → oturum düşürülmeden devam |
 * | `Authenticated` | kabuğun `NavHost`'una ait (A2.1) |
 *
 * Koyu iki satır **iOS'ta canlı bir hatanın düzeltmesi**: orada `goBack()` yalnız `step`
 * değiştiriyor ama token çoktan kaydedilmiş oluyor. iOS'ta çoğunlukla gizleniyor çünkü
 * uygulama ayakta kalıyor; Android'de sonraki soğuk açılış diskte oturum bulur, `me()`
 * çağırır, `phoneVerified == false` görür ve kullanıcıyı yeniden kurulumdan başka çıkışı
 * olmayan telefon doğrulama ekranına bırakır.
 *
 * `PredictiveBackHandler` bilerek KULLANILMIYOR: animasyon edilecek paylaşılan bir öğe
 * yok ve bir durum makinesinde kaydırma jesti bozuk hissettirir. Tahmini geri A2.1'in
 * `NavHost`'una ait.
 */
@Composable
fun AuthBackHandler(
    step: AuthStep,
    onEvent: (AuthEvent) -> Unit,
) {
    when (step) {
        // Handler kurulmaz: kökte geri tuşu uygulamadan çıkar (Android deyimi).
        AuthStep.Launch, AuthStep.Identifier, is AuthStep.Authenticated -> Unit

        // Kodlar bir kez gösterilir; ekrandan çıkış yalnız onay kutusu + "Devam".
        is AuthStep.BackupCodesDisplay -> BackHandler(enabled = true) { /* bilerek yutulur */ }

        else -> BackHandler(enabled = true) { onEvent(AuthEvent.Back) }
    }
}
