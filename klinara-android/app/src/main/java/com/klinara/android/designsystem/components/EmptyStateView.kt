package com.klinara.android.designsystem.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.res.painterResource
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
 * Boş durum bir hata değildir ve öyle görünmemelidir: ikon yumuşak bir adaçayı dairenin
 * içinde durur, `danger` değil. Daire ikonu bir yer tutucu olmaktan çıkarıp ekranın
 * merkezine yerleştiriyor — iOS `EmptyStateView` ile aynı görsel dil. Metin **ne olduğunu
 * değil ne yapılacağını** söyler; "Liste boş" bir kullanıcıya hiçbir şey öğretmez.
 *
 * Ekran okuyucuya **tek bir düğüm** olarak duyurulur: ikon + başlık + mesaj üç ayrı
 * duraklama olarak okunursa TalkBack kullanıcısı boş bir ekranda üç kez durur. [actionTitle]
 * verilirse düğme bu düğümün DIŞINDA kalır — tıklanabilir bir öğe metne gömülemez.
 *
 * [actionTitle] iOS `EmptyStateView.actionTitle` paritesi: liste boşken birincil aksiyon
 * yalnız üst çubuktaki ikonda kalırsa, ekranı ilk kez açan kişi nereye basacağını bulamaz.
 * [actionIcon] düğmenin başına küçük bir ikon koyar; varsayılan artı, çünkü bu düğmelerin
 * hemen hepsi bir şey yaratıyor.
 *
 * [iconRes] verilirse [icon] yerine `res/drawable` altındaki elde çizilmiş vektör kullanılır
 * ([KlinaraIcons]). `material-icons-core` kırk küsur ikon taşıyor ve paket, şablon, izin gibi
 * kavramların karşılığı orada yok; iOS'un SF Symbol seçimiyle aynı anlamı taşıyan glif
 * oradan gelir.
 */
@Composable
fun EmptyStateView(
    title: String,
    message: String,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.Filled.Info,
    @DrawableRes iconRes: Int? = null,
    actionTitle: String? = null,
    actionIcon: ImageVector? = Icons.Filled.Add,
    onAction: (() -> Unit)? = null,
) {
    val colors = KlinaraTheme.colors
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(vertical = KlinaraMetrics.xxl, horizontal = KlinaraMetrics.md),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
    ) {
        Column(
            modifier = Modifier.clearAndSetSemantics { contentDescription = "$title. $message" },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
        ) {
            Box(
                modifier = Modifier.size(EMPTY_CIRCLE_SIZE).background(colors.sageSoft, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = if (iconRes != null) painterResource(iconRes) else rememberVectorPainter(icon),
                    contentDescription = null,
                    tint = colors.sageDeep,
                    modifier = Modifier.size(EMPTY_ICON_SIZE),
                )
            }
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

        if (actionTitle != null && onAction != null) {
            KlinaraButton(
                title = actionTitle,
                onClick = onAction,
                modifier = Modifier.widthIn(max = ACTION_MAX_WIDTH),
                kind = KlinaraButtonKind.Secondary,
                icon = actionIcon,
            )
        }
    }
}

private val EMPTY_CIRCLE_SIZE = 72.dp
private val EMPTY_ICON_SIZE = 30.dp

/** iOS'taki 260 pt ile aynı: tam genişlikte bir düğme boş ekranda çığırtkan duruyordu. */
private val ACTION_MAX_WIDTH = 260.dp

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

@KlinaraPreviews
@Composable
private fun EmptyStateActionPreview() {
    KlinaraTheme {
        EmptyStateView(
            title = "Henüz paket yok",
            message = "İlk paketi tanımlayarak başlayın.",
            actionTitle = "Yeni paket",
            onAction = {},
        )
    }
}
