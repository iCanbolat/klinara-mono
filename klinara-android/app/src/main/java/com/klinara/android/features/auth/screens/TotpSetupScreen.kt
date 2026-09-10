package com.klinara.android.features.auth.screens

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.net.toUri
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthScaffold
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.rememberClipboardCopy
import com.klinara.android.designsystem.components.OtpCodeField
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.features.auth.AuthStep
import com.klinara.android.features.auth.AuthUiState

/**
 * Zorunlu 2FA kurulumu (yumurta-tavuk akışı, §4.7).
 *
 * **QR kodu YOK** — iOS `TOTPSetupView` de göstermiyor; gizli anahtar + kopyala düğmesi.
 * Bir QR kütüphanesi eklemek ya da elle kodlayıcı yazmak, iki istemcide farklı bir
 * kurulum deneyimi için ödenecek bedel olurdu (§6 A1.2'deki "QR + gizli anahtar" ifadesi
 * iOS'un gerçeğiyle uyuşmuyor; iOS izlendi).
 *
 * Üstüne **"Uygulamada aç"** eklendi: `otpauth://` şemasını kimlik doğrulayıcıya
 * devretmek Android'de gerçekten deyimsel ve yeni bağımlılık istemiyor. Kasıtlı
 * platform farkı (§7.8).
 */
@Composable
fun TotpSetupScreen(
    step: AuthStep.TotpSetup,
    state: AuthUiState,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    val copyToClipboard = rememberClipboardCopy()
    val context = LocalContext.current

    AuthScaffold(
        modifier = modifier,
        eyebrow = "Zorunlu adım",
        title = "İki adımlı doğrulama",
        subtitle = "Kliniğiniz iki adımlı doğrulamayı zorunlu kılıyor. Kurulumu tamamlayın.",
        onBack = { onEvent(AuthEvent.Back) },
        actions = {
            KlinaraButton(
                title = "Kurulumu tamamla",
                onClick = { onEvent(AuthEvent.ConfirmTotpSetup) },
                enabled = state.canSubmitTotpSetupCode,
                isLoading = state.isBusy,
            )
        },
    ) {
        state.error?.let { ErrorBanner(message = it.message, supportReference = it.supportReference) }

        KlinaraCard(title = "1. Anahtarı ekleyin") {
            Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
                Text(
                    step.secret,
                    style = KlinaraType.code,
                    color = KlinaraTheme.colors.charcoal,
                )
                KlinaraButton(
                    title = "Anahtarı kopyala",
                    onClick = { copyToClipboard("Klinara TOTP anahtarı", step.secret) },
                    kind = KlinaraButtonKind.Secondary,
                )
                KlinaraButton(
                    title = "Uygulamada aç",
                    onClick = {
                        // Kurulu bir kimlik doğrulayıcı yoksa sessizce yut: kullanıcı
                        // anahtarı elle de ekleyebilir ve bu bir hata değil.
                        runCatching {
                            context.startActivity(Intent(Intent.ACTION_VIEW, step.otpauthUri.toUri()))
                        }.onFailure { if (it !is ActivityNotFoundException) throw it }
                    },
                    kind = KlinaraButtonKind.Tertiary,
                )
            }
        }

        KlinaraCard(title = "2. Kodu doğrulayın") {
            OtpCodeField(
                code = state.totpSetupCode,
                onCodeChange = { onEvent(AuthEvent.TotpSetupCodeChanged(it)) },
                hasError = state.error != null,
                onComplete = { onEvent(AuthEvent.ConfirmTotpSetup) },
            )
        }
    }
}

@KlinaraPreviews
@Composable
private fun TotpSetupScreenPreview() {
    KlinaraTheme {
        TotpSetupScreen(
            step = AuthStep.TotpSetup("JBSWY3DPEHPK3PXP", "otpauth://totp/Klinara"),
            state = AuthUiState(),
            onEvent = {},
        )
    }
}
