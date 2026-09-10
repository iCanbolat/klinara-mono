package com.klinara.android.features.auth.screens

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.components.AuthScaffold
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.OtpCodeField
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.features.auth.AuthStep
import com.klinara.android.features.auth.AuthUiState

@Composable
fun TotpScreen(
    step: AuthStep.Totp,
    state: AuthUiState,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        modifier = modifier,
        title = "Doğrulama kodu",
        subtitle = "Kimlik doğrulayıcı uygulamanızdaki altı haneli kodu girin.",
        onBack = { onEvent(AuthEvent.Back) },
        actions = {
            KlinaraButton(
                title = "Doğrula",
                onClick = { onEvent(AuthEvent.SubmitMfaCode) },
                enabled = state.canSubmitMfaCode,
                isLoading = state.isBusy,
            )
            if (step.allowsBackupCode) {
                KlinaraButton(
                    title = "Yedek kod kullan",
                    onClick = { onEvent(AuthEvent.UseBackupCode) },
                    kind = KlinaraButtonKind.Tertiary,
                )
            }
        },
    ) {
        state.error?.let { ErrorBanner(message = it.message, supportReference = it.supportReference) }

        OtpCodeField(
            code = state.mfaCode,
            onCodeChange = { onEvent(AuthEvent.MfaCodeChanged(it)) },
            hasError = state.error != null,
            onComplete = { onEvent(AuthEvent.SubmitMfaCode) },
        )
    }
}

@Composable
fun BackupCodeEntryScreen(
    state: AuthUiState,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        modifier = modifier,
        title = "Yedek kod",
        subtitle = "Kurulum sırasında aldığınız kodlardan birini girin. Her kod bir kez kullanılır.",
        onBack = { onEvent(AuthEvent.Back) },
        actions = {
            KlinaraButton(
                title = "Doğrula",
                onClick = { onEvent(AuthEvent.SubmitBackupCode) },
                enabled = state.canSubmitBackupCode,
                isLoading = state.isBusy,
            )
            KlinaraButton(
                title = "Doğrulama kodu kullan",
                onClick = { onEvent(AuthEvent.UseAuthenticatorCode) },
                kind = KlinaraButtonKind.Tertiary,
            )
        },
    ) {
        state.error?.let { ErrorBanner(message = it.message, supportReference = it.supportReference) }

        com.klinara.android.designsystem.components.KlinaraTextField(
            label = "Yedek kod",
            value = state.backupCode,
            onValueChange = { onEvent(AuthEvent.BackupCodeChanged(it)) },
            placeholder = "4f2a-9c1e",
            error = state.error?.fieldErrors?.get("code"),
            imeAction = androidx.compose.ui.text.input.ImeAction.Done,
            onSubmit = { onEvent(AuthEvent.SubmitBackupCode) },
        )
    }
}

@KlinaraPreviews
@Composable
private fun TotpScreenPreview() {
    KlinaraTheme {
        TotpScreen(
            step = AuthStep.Totp(allowsBackupCode = true),
            state = AuthUiState(mfaCode = "4829"),
            onEvent = {},
        )
    }
}
