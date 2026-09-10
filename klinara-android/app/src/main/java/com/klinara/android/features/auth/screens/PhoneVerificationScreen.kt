package com.klinara.android.features.auth.screens

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthScaffold
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.OtpCodeField
import com.klinara.android.designsystem.components.PhoneNumber
import com.klinara.android.designsystem.components.PhoneNumberField
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.features.auth.AuthStep
import com.klinara.android.features.auth.AuthUiState
import kotlinx.coroutines.delay
import java.time.Duration
import java.time.Instant

/**
 * İki alt durum tek ekranda: numara girişi → kod girişi.
 *
 * Doğrulanmamış bir telefon giriş tanımlayıcısı DEĞİLDİR; bu adım şube seçiminden önce
 * gelir ve atlanamaz.
 */
@Composable
fun PhoneVerificationScreen(
    step: AuthStep.PhoneVerification,
    state: AuthUiState,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    val awaitingCode = step.codeExpiresAt != null

    AuthScaffold(
        modifier = modifier,
        eyebrow = "Zorunlu adım",
        title = if (awaitingCode) "Kodu girin" else "Telefonunuzu doğrulayın",
        subtitle =
            if (awaitingCode) {
                "${PhoneNumber.pretty(step.phone.orEmpty())} numarasına gönderilen altı haneli kodu girin."
            } else {
                "Randevu bildirimleri ve hesap güvenliği için numaranızı doğrulamamız gerekiyor."
            },
        actions = {
            if (awaitingCode) {
                KlinaraButton(
                    title = "Doğrula",
                    onClick = { onEvent(AuthEvent.SubmitPhoneCode) },
                    enabled = state.canSubmitSmsCode,
                    isLoading = state.isBusy,
                )
                KlinaraButton(
                    title = "Numarayı değiştir",
                    onClick = { onEvent(AuthEvent.ChangePhoneNumber) },
                    kind = KlinaraButtonKind.Tertiary,
                )
            } else {
                KlinaraButton(
                    title = "Kod gönder",
                    onClick = { onEvent(AuthEvent.SendPhoneCode) },
                    enabled = state.canSubmitPhoneToVerify,
                    isLoading = state.isBusy,
                )
                KlinaraButton(
                    title = "Çıkış yap",
                    onClick = { onEvent(AuthEvent.Logout) },
                    kind = KlinaraButtonKind.Tertiary,
                )
            }
        },
    ) {
        state.error?.let { error ->
            ErrorBanner(
                message = error.message,
                supportReference = error.supportReference,
                onRetry = if (error.isRetryable) ({ onEvent(AuthEvent.SendPhoneCode) }) else null,
            )
        }

        if (awaitingCode) {
            OtpCodeField(
                code = state.smsCode,
                onCodeChange = { onEvent(AuthEvent.SmsCodeChanged(it)) },
                hasError = state.error != null,
                onComplete = { onEvent(AuthEvent.SubmitPhoneCode) },
            )
            CodeCountdown(expiresAt = step.codeExpiresAt, onExpired = { onEvent(AuthEvent.SendPhoneCode) })
        } else {
            PhoneNumberField(
                label = "Telefon numarası",
                e164 = state.phoneToVerify,
                onE164Change = { onEvent(AuthEvent.PhoneToVerifyChanged(it)) },
                error = state.error?.fieldErrors?.get("phone"),
                onSubmit = { onEvent(AuthEvent.SendPhoneCode) },
            )
        }
    }
}

/**
 * Geri sayım **sunucunun `expiresAt`'inden** türetilir, istemci sayacından değil.
 *
 * Bir istemci sayacı uygulama arka plana alınınca durur ya da kayar; sunucunun mutlak
 * zamanından hesaplamak, kullanıcı dönünce doğru süreyi göstermeyi garantiler.
 */
@Composable
private fun CodeCountdown(
    expiresAt: Instant,
    onExpired: () -> Unit,
) {
    var remaining by remember(expiresAt) { mutableStateOf(secondsUntil(expiresAt)) }

    LaunchedEffect(expiresAt) {
        while (remaining > 0) {
            delay(TICK_MILLIS)
            remaining = secondsUntil(expiresAt)
        }
    }

    Text(
        text =
            if (remaining > 0) {
                "Kodun geçerlilik süresi: ${remaining / SECONDS_PER_MINUTE}:" +
                    "%02d".format(remaining % SECONDS_PER_MINUTE)
            } else {
                "Kodun süresi doldu."
            },
        style = KlinaraType.bodyM,
        color = KlinaraTheme.colors.charcoalMuted,
    )

    if (remaining <= 0) {
        KlinaraButton(
            title = "Yeni kod gönder",
            onClick = onExpired,
            kind = KlinaraButtonKind.Secondary,
        )
    }
}

private fun secondsUntil(expiresAt: Instant): Long =
    Duration.between(Instant.now(), expiresAt).seconds.coerceAtLeast(0)

private const val TICK_MILLIS = 1_000L
private const val SECONDS_PER_MINUTE = 60
private const val PREVIEW_REMAINING_SECONDS = 240L

@KlinaraPreviews
@Composable
private fun PhoneVerificationPreview() {
    KlinaraTheme {
        PhoneVerificationScreen(
            step = AuthStep.PhoneVerification("+905321234567", Instant.now().plusSeconds(PREVIEW_REMAINING_SECONDS)),
            state = AuthUiState(smsCode = "482"),
            onEvent = {},
        )
    }
}
