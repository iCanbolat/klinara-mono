package com.klinara.android.app

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.KlinaraApplication
import com.klinara.android.features.auth.AuthFlowViewModel

/**
 * Release varyantının kökü.
 *
 * Geliştirici araçları (senaryo menüsü, token/bileşen galerileri) buraya asla girmez:
 * `onOpenDeveloperMenu` null geçilir ve uzun basma jesti hiç kurulmaz.
 */
@Composable
internal fun RootContent(
    modifier: Modifier = Modifier,
    onSessionResolved: () -> Unit = {},
) {
    val app = LocalContext.current.applicationContext as KlinaraApplication
    val viewModel: AuthFlowViewModel = viewModel(factory = AuthFlowViewModel.Factory)
    RootScreen(
        viewModel = viewModel,
        container = app.container,
        modifier = modifier.fillMaxSize(),
        onSessionResolved = onSessionResolved,
    )
}
