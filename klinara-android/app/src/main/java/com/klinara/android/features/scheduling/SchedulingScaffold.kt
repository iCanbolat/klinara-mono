package com.klinara.android.features.scheduling

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.runtime.Composable
import com.klinara.android.designsystem.components.EmptyStateView

/** Şube seçilmemiş oturum — scheduling uçları `X-Branch-Id` olmadan 400 veriyor (iOS metni). */
@Composable
internal fun NoBranchState(message: String) {
    EmptyStateView(title = "Şube seçilmedi", message = message, icon = Icons.Filled.DateRange)
}
