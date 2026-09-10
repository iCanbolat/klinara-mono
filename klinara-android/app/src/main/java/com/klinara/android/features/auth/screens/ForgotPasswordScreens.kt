package com.klinara.android.features.auth.screens

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthScaffold
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.features.auth.AuthUiState

@Composable
fun ForgotPasswordEmailScreen(
    state: AuthUiState,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        modifier = modifier,
        title = "Parolamı unuttum",
        subtitle = "Hesabınızın e-posta adresini girin, sıfırlama bağlantısı gönderelim.",
        onBack = { onEvent(AuthEvent.Back) },
        actions = {
            KlinaraButton(
                title = "Bağlantı gönder",
                onClick = { onEvent(AuthEvent.SubmitForgotPassword) },
                enabled = state.canSubmitForgotPassword,
                isLoading = state.isBusy,
            )
        },
    ) {
        state.error?.let { ErrorBanner(message = it.message, supportReference = it.supportReference) }

        KlinaraTextField(
            label = "E-posta",
            value = state.forgotPasswordEmail,
            onValueChange = { onEvent(AuthEvent.ForgotPasswordEmailChanged(it)) },
            placeholder = "ornek@klinik.com",
            keyboardType = KeyboardType.Email,
            imeAction = ImeAction.Done,
            onSubmit = { onEvent(AuthEvent.SubmitForgotPassword) },
        )
    }
}

/**
 * Onay ekranı **bilerek nötr**: "böyle bir hesap var/yok" bilgisini vermez.
 *
 * Sunucu da aynı sözleşmeyi tutuyor ve `forgotPassword` asla hata fırlatmıyor. Aksi
 * hâlde bu ekran bir hesap sayım aracına dönerdi.
 */
@Composable
fun ForgotPasswordSentScreen(
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        modifier = modifier,
        title = "Bağlantı gönderildi",
        subtitle = "Bu adres kayıtlıysa sıfırlama bağlantısı gönderildi. Gelen kutunuzu kontrol edin.",
        onBack = { onEvent(AuthEvent.Back) },
        actions = {
            KlinaraButton(title = "Girişe dön", onClick = { onEvent(AuthEvent.Back) })
        },
    ) {
        Text(
            "Bağlantı kısa süre geçerlidir. Ulaşmazsa spam klasörünü kontrol edin.",
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.charcoalMuted,
        )
    }
}

@KlinaraPreviews
@Composable
private fun ForgotPasswordSentPreview() {
    KlinaraTheme { ForgotPasswordSentScreen(onEvent = {}) }
}
