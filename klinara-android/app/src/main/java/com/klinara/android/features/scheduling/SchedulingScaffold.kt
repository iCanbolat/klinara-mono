package com.klinara.android.features.scheduling

import androidx.activity.compose.BackHandler
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.EmptyStateView

/**
 * Kaydedilmemiş taslak koruması — iOS `KlinaraFormScaffold`'ın "Değişiklikler
 * kaydedilmedi" diyaloğunun Android karşılığı.
 *
 * Hafta ekranları tam değiştirme ile kaydediyor; yedi günlük bir düzenlemeyi sistem geri
 * tuşuyla sessizce kaybetmek, iOS'ta sheet'in kaydırılarak kapatılamamasının tersi olurdu.
 * Döndürdüğü fonksiyon üst çubuğun geri okuna verilir: iki çıkış yolu da aynı soruyu sorar.
 */
@Composable
internal fun rememberUnsavedChangesGuard(
    isDirty: Boolean,
    onLeave: () -> Unit,
): () -> Unit {
    var isAsking by rememberSaveable { mutableStateOf(false) }
    BackHandler(enabled = isDirty) { isAsking = true }

    if (isAsking) {
        AlertDialog(
            onDismissRequest = { isAsking = false },
            title = { Text("Değişiklikler kaydedilmedi", style = KlinaraType.titleM) },
            text = { Text("Çıkarsanız bu ekrandaki düzenlemeler kaybolur.", style = KlinaraType.bodyM) },
            confirmButton = {
                TextButton(onClick = {
                    isAsking = false
                    onLeave()
                }) { Text("Değişiklikleri sil") }
            },
            dismissButton = { TextButton(onClick = { isAsking = false }) { Text("Düzenlemeye dön") } },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        )
    }
    return { if (isDirty) isAsking = true else onLeave() }
}

/** Şube seçilmemiş oturum — scheduling uçları `X-Branch-Id` olmadan 400 veriyor (iOS metni). */
@Composable
internal fun NoBranchState(message: String) {
    EmptyStateView(title = "Şube seçilmedi", message = message, icon = Icons.Filled.DateRange)
}
