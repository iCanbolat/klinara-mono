package com.klinara.android.designsystem.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import kotlinx.coroutines.launch

/**
 * Panoya kopyalama.
 *
 * `LocalClipboardManager` deprecated (suspend desteklemiyor); `LocalClipboard`
 * kullanılıyor ve `ClipEntry` kurmanın gürültüsü tek yerde toplanıyor — yoksa her
 * kopyala düğmesi aynı beş satırı tekrar ederdi.
 */
@Composable
fun rememberClipboardCopy(): (label: String, text: String) -> Unit {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    return remember(clipboard, scope) {
        { label, text ->
            scope.launch {
                clipboard.setClipEntry(
                    ClipEntry(android.content.ClipData.newPlainText(label, text)),
                )
            }
            Unit
        }
    }
}
