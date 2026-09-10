package com.klinara.android.app

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.features.auth.AuthBackHandler
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.features.auth.AuthFlowViewModel
import com.klinara.android.features.auth.AuthStep
import com.klinara.android.features.auth.screens.AuthenticatedPlaceholderScreen
import com.klinara.android.features.auth.screens.BackupCodeEntryScreen
import com.klinara.android.features.auth.screens.BackupCodesScreen
import com.klinara.android.features.auth.screens.BranchSelectScreen
import com.klinara.android.features.auth.screens.ForgotPasswordEmailScreen
import com.klinara.android.features.auth.screens.ForgotPasswordSentScreen
import com.klinara.android.features.auth.screens.IdentifierScreen
import com.klinara.android.features.auth.screens.LaunchScreen
import com.klinara.android.features.auth.screens.PasskeyEnrollOfferScreen
import com.klinara.android.features.auth.screens.PasswordScreen
import com.klinara.android.features.auth.screens.PhoneVerificationScreen
import com.klinara.android.features.auth.screens.TenantSelectScreen
import com.klinara.android.features.auth.screens.TotpScreen
import com.klinara.android.features.auth.screens.TotpSetupScreen

/**
 * Giriş akışının kökü.
 *
 * **`NavHost` YOK.** Giriş bir ağaç değil doğrusal bir durum makinesidir; bir yığın
 * kullanmak sistem geri tuşunu "2FA ekranından geri gidip yarım kimlikle takılma"
 * durumuna açar (§5.3). Adımlar `when` ile ekrana eşlenir.
 *
 * Oturum açıldıktan sonra (A2.1) `AppShell` normal Android gezinmesini devralır ve orada
 * her sekmenin kendi geri yığını olur.
 */
@Composable
fun RootScreen(
    viewModel: AuthFlowViewModel,
    modifier: Modifier = Modifier,
    onOpenDeveloperMenu: (() -> Unit)? = null,
    onSessionResolved: () -> Unit = {},
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.onEvent(AuthEvent.Start) }

    // Launch'tan çıkıldığı an sistem splash'i bırakılır — ne erken (boş kare) ne geç.
    LaunchedEffect(state.step, state.error) {
        // Hata varsa da splash bırakılır: aksi hâlde kullanıcı sonsuza dek splash görür.
        if (state.step != AuthStep.Launch || state.error != null) onSessionResolved()
    }

    AuthBackHandler(step = state.step, onEvent = viewModel::onEvent)

    Box(modifier = modifier.fillMaxSize()) {
        AnimatedContent(
            targetState = state.step,
            transitionSpec = {
                val spec = tween<Float>(KlinaraMetrics.STEP_TRANSITION_MILLIS)
                fadeIn(spec) togetherWith fadeOut(spec)
            },
            label = "authStep",
        ) { step ->
            AuthStepContent(
                step = step,
                state = state,
                onEvent = viewModel::onEvent,
                onOpenDeveloperMenu = onOpenDeveloperMenu,
            )
        }

        state.overlayMessage?.let { AuthLoadingOverlay(message = it) }
    }
}

/**
 * Adım → ekran eşlemesi.
 *
 * Ayrı bir fonksiyon: gövdesi TEK bir `when` olduğu için bir dispatch tablosudur ve
 * `RootScreen` yapıya (geçiş animasyonu, geri tuşu, örtü) odaklanmış kalır.
 */
@Composable
private fun AuthStepContent(
    step: AuthStep,
    state: com.klinara.android.features.auth.AuthUiState,
    onEvent: (AuthEvent) -> Unit,
    onOpenDeveloperMenu: (() -> Unit)?,
) {
when (step) {
            AuthStep.Launch ->
            LaunchScreen(
                error = state.error,
                onEvent = onEvent,
                onOpenDeveloperMenu = onOpenDeveloperMenu,
            )

            AuthStep.Identifier ->
                IdentifierScreen(
                    state = state,
                    onEvent = onEvent,
                    onOpenDeveloperMenu = onOpenDeveloperMenu,
                )

            AuthStep.Password -> PasswordScreen(state, onEvent)

            is AuthStep.Totp -> TotpScreen(step, state, onEvent)

            AuthStep.BackupCode -> BackupCodeEntryScreen(state, onEvent)

            is AuthStep.TotpSetup -> TotpSetupScreen(step, state, onEvent)

            is AuthStep.BackupCodesDisplay -> BackupCodesScreen(step, onEvent)

            is AuthStep.TenantSelect -> TenantSelectScreen(step, state, onEvent)

            is AuthStep.BranchSelect -> BranchSelectScreen(step, state, onEvent)

            AuthStep.ForgotPasswordEmail -> ForgotPasswordEmailScreen(state, onEvent)

            AuthStep.ForgotPasswordSent -> ForgotPasswordSentScreen(onEvent)

            is AuthStep.PhoneVerification -> PhoneVerificationScreen(step, state, onEvent)

            AuthStep.PasskeyEnrollOffer -> PasskeyEnrollOfferScreen(state, onEvent)

            // A2.1'de AppShell (alt gezinme) bunun yerine geçecek.
            is AuthStep.Authenticated ->
                AuthenticatedPlaceholderScreen(step.session, onEvent)
        }
}
