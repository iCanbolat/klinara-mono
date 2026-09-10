package com.klinara.android.features.shell

import androidx.compose.foundation.layout.RowScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.KlinaraScreen

/**
 * Henüz yazılmamış fazların sekmesi.
 *
 * **Sahte veri gösterilmez.** Dolu görünen bir takvim, kullanıcının randevu almayı
 * denemesine ve uygulamaya olan güvenini kaybetmesine yol açar; boş bir ekran
 * dürüsttür. iOS `ComingSoonView` paritesi ve aynı gerekçe.
 *
 * Mesaj hangi fazda geleceğini söyler: "yakında" bir tarih değil, bir mazerettir.
 */
@Composable
fun ComingSoonScreen(
    title: String,
    headline: String,
    message: String,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.Filled.Info,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    KlinaraScreen(title = title, modifier = modifier, trailing = trailing) {
        // [headline] üst çubuktaki [title]'dan FARKLI olmalı: aynı kelimeyi arka arkaya
        // iki kez okumak ekran okuyucuda gereksiz bir tekrar, gözle de gürültü.
        EmptyStateView(title = headline, message = message, icon = icon)
    }
}
