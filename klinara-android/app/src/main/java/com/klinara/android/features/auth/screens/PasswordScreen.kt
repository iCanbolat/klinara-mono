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
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.PhoneNumber
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.features.auth.AuthStep
import com.klinara.android.features.auth.AuthUiState
import com.klinara.android.features.auth.IdentifierMode

@Composable
fun PasswordScreen(
    state: AuthUiState,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    val summary =
        when (state.identifierMode) {
            IdentifierMode.Phone -> PhoneNumber.pretty(state.phoneE164)
            IdentifierMode.Email -> state.email
        }

    AuthScaffold(
        modifier = modifier,
        title = "Parolanız",
        subtitle = summary,
        // Geri = "Değiştir": tanımlayıcıyı düzeltmenin tek yolu ve parolayı temizler.
        onBack = { onEvent(AuthEvent.Back) },
        actions = {
            KlinaraButton(
                title = "Giriş yap",
                onClick = { onEvent(AuthEvent.SubmitPassword) },
                enabled = state.canSubmitPassword,
                isLoading = state.isBusy,
            )
            KlinaraButton(
                title = "Parolamı unuttum",
                onClick = { onEvent(AuthEvent.OpenForgotPassword) },
                kind = KlinaraButtonKind.Tertiary,
            )
        },
    ) {
        state.error?.let { error ->
            ErrorBanner(
                message = error.message,
                supportReference = error.supportReference,
                onRetry = if (error.isRetryable) ({ onEvent(AuthEvent.SubmitPassword) }) else null,
            )
        }

        KlinaraTextField(
            label = "Parola",
            value = state.password,
            onValueChange = { onEvent(AuthEvent.PasswordChanged(it)) },
            error = state.error?.fieldErrors?.get("password"),
            isSecure = true,
            keyboardType = KeyboardType.Password,
            imeAction = ImeAction.Done,
            onSubmit = { onEvent(AuthEvent.SubmitPassword) },
        )

        // Minimum sunucu kuralıdır; kullanıcıya SÖYLENİR ki düğmenin neden kapalı
        // olduğunu tahmin etmek zorunda kalmasın.
        Text(
            "En az ${AuthUiState.MIN_PASSWORD_LENGTH} karakter.",
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.charcoalMuted,
        )
    }
}

@KlinaraPreviews
@Composable
private fun PasswordScreenPreview() {
    KlinaraTheme {
        PasswordScreen(
            state = AuthUiState(step = AuthStep.Password, phoneE164 = "+905321234567", password = "kisa"),
            onEvent = {},
        )
    }
}
