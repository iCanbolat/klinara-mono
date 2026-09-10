package com.klinara.android.features.auth.screens

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.components.AuthScaffold
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraLogoMark
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.PhoneNumberField
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.features.auth.AuthStep
import com.klinara.android.features.auth.AuthUiState
import com.klinara.android.features.auth.IdentifierMode

/**
 * Giriş akışının ilk ekranı: telefon (varsayılan) veya e-posta — **tam olarak biri**.
 *
 * [onOpenDeveloperMenu] yalnız debug varyantında dolu gelir. Logoya uzun basma bilerek
 * buradan erişilebilir: `WrongPassword` ve `AccountLocked` senaryoları kullanıcıyı
 * başka türlü çıkışsız bırakır (iOS'ta tam olarak bu yaşandı).
 */
@Composable
fun IdentifierScreen(
    state: AuthUiState,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
    onOpenDeveloperMenu: (() -> Unit)? = null,
) {
    AuthScaffold(
        modifier = modifier,
        title = "Giriş yap",
        subtitle = "Kliniğinize erişmek için hesabınızla devam edin.",
        actions = {
            KlinaraButton(
                title = "Devam et",
                onClick = { onEvent(AuthEvent.SubmitIdentifier) },
                enabled = state.canSubmitIdentifier,
                isLoading = state.isBusy,
            )
            KlinaraButton(
                title =
                    if (state.identifierMode == IdentifierMode.Phone) {
                        "E-posta ile devam et"
                    } else {
                        "Telefon ile devam et"
                    },
                onClick = { onEvent(AuthEvent.SwitchIdentifierMode) },
                kind = KlinaraButtonKind.Tertiary,
            )
        },
    ) {
        // Marka işareti başlığın üstünde değil içerikte: uzun basma jesti için bir
        // hedefe ihtiyaç var ve AuthScaffold'ın başlığı ortak.
        Box(
            modifier =
                Modifier.then(
                    if (onOpenDeveloperMenu != null) {
                        Modifier.pointerInput(Unit) {
                            detectTapGestures(onLongPress = { onOpenDeveloperMenu() })
                        }
                    } else {
                        Modifier
                    },
                ),
        ) {
            KlinaraLogoMark()
        }

        state.error?.let { error ->
            ErrorBanner(
                message = error.message,
                supportReference = error.supportReference,
                onRetry = if (error.isRetryable) ({ onEvent(AuthEvent.SubmitIdentifier) }) else null,
            )
        }

        when (state.identifierMode) {
            IdentifierMode.Phone ->
                PhoneNumberField(
                    label = "Telefon numarası",
                    e164 = state.phoneE164,
                    onE164Change = { onEvent(AuthEvent.PhoneChanged(it)) },
                    error = state.error?.fieldErrors?.get("phone"),
                    imeAction = ImeAction.Done,
                    onSubmit = { onEvent(AuthEvent.SubmitIdentifier) },
                )

            IdentifierMode.Email ->
                KlinaraTextField(
                    label = "E-posta",
                    value = state.email,
                    onValueChange = { onEvent(AuthEvent.EmailChanged(it)) },
                    placeholder = "ornek@klinik.com",
                    error = state.error?.fieldErrors?.get("email"),
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Done,
                    onSubmit = { onEvent(AuthEvent.SubmitIdentifier) },
                )
        }

        if (state.offersPasskeyShortcut) {
            KlinaraButton(
                title = "Passkey ile giriş",
                onClick = { onEvent(AuthEvent.SignInWithPasskey) },
                kind = KlinaraButtonKind.Secondary,
                icon = Icons.Filled.Lock,
            )
        }
    }
}

@KlinaraPreviews
@Composable
private fun IdentifierScreenPreview() {
    KlinaraTheme {
        IdentifierScreen(state = AuthUiState(step = AuthStep.Identifier), onEvent = {})
    }
}
