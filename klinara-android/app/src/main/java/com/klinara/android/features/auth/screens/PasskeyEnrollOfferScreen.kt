package com.klinara.android.features.auth.screens

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthScaffold
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.features.auth.AuthUiState

/**
 * Parolayla ilk girişin ardından passkey kayıt teklifi.
 *
 * A1.5 ertelendiği sürece bu ekrana HİÇ gidilmez (`UnavailablePasskeyService`
 * `isAvailable() = false` döner). Ekran şimdi yazıldı ki A1.5 saf bir değiştirme olsun.
 *
 * "Şimdi değil" oturumu **düşürmez** — kullanıcı zaten giriş yaptı; onu bir kolaylığı
 * reddettiği için çıkışa atmak cezalandırmak olurdu.
 */
@Composable
fun PasskeyEnrollOfferScreen(
    state: AuthUiState,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        modifier = modifier,
        title = "Passkey kurulsun mu?",
        subtitle = "Bir sonraki girişinizde parola yazmak yerine parmak izinizi kullanabilirsiniz.",
        actions = {
            KlinaraButton(
                title = "Passkey kur",
                onClick = { onEvent(AuthEvent.EnrollPasskey) },
                icon = Icons.Filled.Lock,
                isLoading = state.isBusy,
            )
            KlinaraButton(
                title = "Şimdi değil",
                onClick = { onEvent(AuthEvent.SkipPasskeyEnrollment) },
                kind = KlinaraButtonKind.Tertiary,
            )
        },
    ) {
        state.error?.let { ErrorBanner(message = it.message, supportReference = it.supportReference) }

        KlinaraCard {
            KlinaraRow(label = "Daha hızlı", value = "Tek dokunuşla giriş")
            KlinaraRow(label = "Daha güvenli", value = "Parola paylaşılmaz, çalınamaz")
            KlinaraRow(label = "Yedek her zaman var", value = "Parolanız çalışmaya devam eder")
        }

        Text(
            "İstediğiniz zaman profilinizden kaldırabilirsiniz.",
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.charcoalMuted,
        )
    }
}

@KlinaraPreviews
@Composable
private fun PasskeyEnrollOfferPreview() {
    KlinaraTheme { PasskeyEnrollOfferScreen(state = AuthUiState(), onEvent = {}) }
}
