package com.klinara.android.app

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.KlinaraApplication
import com.klinara.android.designsystem.TokenGalleryScreen
import com.klinara.android.designsystem.components.ComponentGalleryScreen
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.features.auth.AuthFlowViewModel
import com.klinara.android.features.auth.screens.DeveloperScenarioScreen
import com.klinara.android.services.mock.MockDataScenario
import com.klinara.android.services.mock.MockScenario

private enum class DebugPane { Auth, Scenarios, Tokens, Components }

/**
 * Debug varyantının kökü.
 *
 * Aynı adlı dosya `src/release` altında da var — varyant kaynak kümeleri birbirini
 * dışlar, bu yüzden senaryo menüsü ve galeriler release APK'ye **hiç girmez**.
 */
@Composable
internal fun RootContent(
    modifier: Modifier = Modifier,
    onSessionResolved: () -> Unit = {},
) {
    val app = LocalContext.current.applicationContext as KlinaraApplication
    var pane by remember { mutableStateOf(DebugPane.Auth) }

    // Container değişince (senaryo geçişi) ViewModel de yeniden kurulmalı; anahtar
    // olarak container kimliği kullanılıyor.
    val container = app.container
    val viewModel: AuthFlowViewModel =
        viewModel(
            key = "auth-${System.identityHashCode(container)}",
            factory = AuthFlowViewModel.Factory,
        )

    when (pane) {
        DebugPane.Auth ->
            RootScreen(
                viewModel = viewModel,
                onSessionResolved = onSessionResolved,
                modifier = modifier.fillMaxSize(),
                onOpenDeveloperMenu = { pane = DebugPane.Scenarios },
            )

        DebugPane.Scenarios ->
            DeveloperScenarioScreen(
                modifier = modifier.fillMaxSize(),
                activeScenario = container.mockAuth?.scenario,
                activeData = container.mockDataScenario,
                isMock = container.isMock,
                onSelect = { scenario: MockScenario, data: MockDataScenario ->
                    app.switchToMock(scenario, data)
                    viewModel.onEvent(AuthEvent.ScenarioChanged)
                    pane = DebugPane.Auth
                },
                onUseLive = {
                    app.switchToLive()
                    viewModel.onEvent(AuthEvent.ScenarioChanged)
                    pane = DebugPane.Auth
                },
                onClose = { pane = DebugPane.Auth },
            )

        DebugPane.Tokens -> TokenGalleryScreen(modifier = modifier.fillMaxSize())
        DebugPane.Components -> ComponentGalleryScreen(modifier = modifier.fillMaxSize())
    }
}
