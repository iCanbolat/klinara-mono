package com.klinara.android.designsystem.components

import androidx.activity.compose.BackHandler
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

/**
 * Kaydedilmemiş taslak koruması — iOS `KlinaraFormScaffold`'ın "Değişiklikler
 * kaydedilmedi" diyaloğunun Android karşılığı.
 *
 * Yedi günlük bir düzenlemeyi sistem geri tuşuyla sessizce kaybetmek, iOS'ta sheet'in
 * kaydırılarak kapatılamamasının tersi olurdu. Döndürdüğü fonksiyon üst çubuğun geri
 * okuna verilir: iki çıkış yolu da aynı soruyu sorar.
 *
 * `features/scheduling`'den buraya taşındı: şube, personel, bildirim ve WhatsApp
 * ekranları da onu kullanıyordu ve bir form davranışı için takvim paketinden içe
 * aktarım yapmak, bağımlılığı yanlış yöne çeviriyordu.
 */
@Composable
fun rememberUnsavedChangesGuard(
    isDirty: Boolean,
    onLeave: () -> Unit,
): () -> Unit {
    var isAsking by rememberSaveable { mutableStateOf(false) }
    BackHandler(enabled = isDirty) { isAsking = true }

    if (isAsking) {
        UnsavedChangesDialog(
            onDiscard = {
                isAsking = false
                onLeave()
            },
            onCancel = { isAsking = false },
        )
    }
    return { if (isDirty) isAsking = true else onLeave() }
}

/** Taslağı atma onayı. [rememberUnsavedChangesGuard] ve [KlinaraBottomSheet] aynı metni kullanır. */
@Composable
fun UnsavedChangesDialog(
    onDiscard: () -> Unit,
    onCancel: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("Değişiklikler kaydedilmedi", style = KlinaraType.titleM) },
        text = { Text("Çıkarsanız bu ekrandaki düzenlemeler kaybolur.", style = KlinaraType.bodyM) },
        confirmButton = { TextButton(onClick = onDiscard) { Text("Değişiklikleri sil") } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Düzenlemeye dön") } },
        containerColor = KlinaraTheme.colors.surfaceRaised,
    )
}
