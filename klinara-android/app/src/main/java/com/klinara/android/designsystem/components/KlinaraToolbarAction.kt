package com.klinara.android.designsystem.components

import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraTheme

/**
 * Üst çubuğun birincil ikon aksiyonu — iOS'un
 * `ToolbarItem(.topBarTrailing) { Image(systemName: "plus") }` paritesi.
 *
 * **Nerede FAB, nerede bu?** Sekme kökü ekranlar (Müşteriler, Takvim, Hizmetler, Personel)
 * FAB kullanır: sık kullanılırlar ve başparmak oraya uzanır. Yönetim'den açılan alt
 * listelerde ise aksiyon seyrek ve liste kısa; oraya FAB koymak her ekranın altında dolaşan
 * ikinci bir katman demekti. Daha önce bu ekranlarda aksiyon kaydırılan içeriğin **en
 * altında** tam genişlik bir düğmeydi: liste uzadıkça görünmez oluyor, kısayken de
 * sayfanın yarısını kaplıyordu.
 *
 * [contentDescription] zorunlu: ikon tek başına anlam taşımaz.
 */
@Composable
fun RowScope.KlinaraToolbarAction(
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.Filled.Add,
    enabled: Boolean = true,
) {
    IconButton(onClick = onClick, modifier = modifier, enabled = enabled) {
        Icon(
            icon,
            contentDescription = contentDescription,
            tint = if (enabled) KlinaraTheme.colors.sageDeep else KlinaraTheme.colors.disabled,
            modifier = Modifier.size(ACTION_ICON_SIZE),
        )
    }
}

private val ACTION_ICON_SIZE = 24.dp
