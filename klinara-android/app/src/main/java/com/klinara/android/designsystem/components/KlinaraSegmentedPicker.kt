package com.klinara.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Kapsül segment seçici — birbirini dışlayan az sayıda görünüm arasında geçiş.
 *
 * A0.3'te "çağıranı yok" diye ertelenmişti; takvimin gün/hafta/ajanda geçişi ilk
 * gerçek çağıran.
 *
 * İsteğe bağlı [icon]: iOS karşılığı ikon + metin taşıyor. `material-icons-core`
 * setinde ızgara/hafta ikonu bulunmadığı için ikonlar `res/drawable` altındaki küçük
 * vektörlerden gelir; `material-icons-extended` bir mod seçici uğruna eklenmedi.
 *
 * Erişilebilirlik: her segment `Role.Tab` ve `selected` durumuyla duyurulur, dokunma
 * hedefi [KlinaraMetrics.minTouchTarget] altına düşmez.
 */
@Composable
fun <T> KlinaraSegmentedPicker(
    options: List<T>,
    selected: T,
    onSelect: (T) -> Unit,
    title: (T) -> String,
    modifier: Modifier = Modifier,
    accessibilityLabel: (T) -> String = title,
    icon: (@Composable (T) -> Painter)? = null,
) {
    val colors = KlinaraTheme.colors
    val shape = RoundedCornerShape(KlinaraMetrics.controlRadius)

    Row(
        modifier =
            modifier
                .background(colors.surfaceRaised, shape)
                .border(KlinaraMetrics.borderWidth, colors.border, shape)
                .padding(TRACK_PADDING),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        options.forEach { option ->
            val isSelected = option == selected
            val interaction = remember(option) { MutableInteractionSource() }

            Box(
                modifier =
                    Modifier
                        .weight(1f)
                        .heightIn(min = SEGMENT_HEIGHT)
                        .background(
                            if (isSelected) colors.sageDeep else colors.surfaceRaised,
                            RoundedCornerShape(SEGMENT_RADIUS),
                        ).klinaraClickable(
                            enabled = true,
                            role = Role.Tab,
                            interactionSource = interaction,
                            onClick = { if (!isSelected) onSelect(option) },
                        ).clearAndSetSemantics {
                            // Tek düğüm: TalkBack "Gün, sekme, seçili" der; iç metnin
                            // ayrıca okunması aynı kelimeyi iki kez duyurmak olurdu.
                            this.selected = isSelected
                            this.role = Role.Tab
                            contentDescription = accessibilityLabel(option)
                        }.padding(horizontal = KlinaraMetrics.xs),
                contentAlignment = Alignment.Center,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    val tint = if (isSelected) colors.surfaceRaised else colors.charcoalMuted
                    if (icon != null) {
                        Icon(icon(option), contentDescription = null, tint = tint, modifier = Modifier.size(ICON_SIZE))
                    }
                    Text(
                        text = title(option),
                        style = KlinaraType.bodyEmphasis,
                        color = tint,
                        maxLines = 1,
                        // fontScale 2.0'da üç segment yan yana sığmıyor; kırpmak sarmaktan
                        // iyi, çünkü seçili durum ve konum anlamı zaten taşıyor (A2.1'de
                        // sekme etiketleri için verilen kararın aynısı).
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

private val TRACK_PADDING = 3.dp
private val SEGMENT_HEIGHT = 40.dp
private val SEGMENT_RADIUS = 9.dp
private val ICON_SIZE = 16.dp
