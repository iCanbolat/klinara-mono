package com.klinara.android.designsystem.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * "Burada henüz bir şey yok" durumu.
 *
 * Boş durum bir hata değildir ve öyle görünmemelidir: ikon `charcoalMuted`, `danger`
 * değil. Metin **ne olduğunu değil ne yapılacağını** söyler; "Liste boş" bir kullanıcıya
 * hiçbir şey öğretmez.
 *
 * Ekran okuyucuya **tek bir düğüm** olarak duyurulur: ikon + başlık + mesaj üç ayrı
 * duraklama olarak okunursa TalkBack kullanıcısı boş bir ekranda üç kez durur.
 */
@Composable
fun EmptyStateView(
    title: String,
    message: String,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.Filled.Info,
) {
    val colors = KlinaraTheme.colors
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(vertical = KlinaraMetrics.xxl, horizontal = KlinaraMetrics.md)
                .clearAndSetSemantics { contentDescription = "$title. $message" },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = colors.charcoalMuted,
            modifier = Modifier.size(EMPTY_ICON_SIZE),
        )
        Text(
            title,
            style = KlinaraType.titleM,
            color = colors.charcoal,
            textAlign = TextAlign.Center,
        )
        Text(
            message,
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
            textAlign = TextAlign.Center,
        )
    }
}

private val EMPTY_ICON_SIZE = 40.dp

@KlinaraPreviews
@Composable
private fun EmptyStatePreview() {
    KlinaraTheme {
        EmptyStateView(
            title = "Takvim erişiminiz yok",
            message = "Rolünüz randevuları görüntülemeyi kapsamıyor.",
        )
    }
}
