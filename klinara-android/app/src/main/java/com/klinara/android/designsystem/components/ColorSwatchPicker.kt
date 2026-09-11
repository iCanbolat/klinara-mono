package com.klinara.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Sabit paletten renk seçici.
 *
 * **A7.1'den A4.2'ye alındı.** A0.3 bunu "çağıranı yok" diye ertelemişti ve kural
 * buydu: bir bileşenin şekli ancak gerçek bir çağıran karşısında doğru kararlaştırılır.
 * Çağıran müşteri etiketi editöründe doğdu; A7.1'deki hizmet kategorisi ikinci çağıran
 * olacak.
 *
 * **Serbest bir renk çarkı DEĞİL.** Sunucu `#RRGGBB` doğruluyor ama asıl mesele o
 * değil: kullanıcıya sınırsız renk vermek, arka planla aynı tonda okunmaz bir etiket
 * ve birbirinden ayırt edilemeyen altı "yeşil" üretir. Palet marka token'larından
 * türüyor.
 *
 * `null` seçimi geçerli bir seçimdir ("renksiz") ve rozet nötr tona düşer.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ColorSwatchPicker(
    selected: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
    label: String = "Renk",
) {
    val colors = KlinaraTheme.colors

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
        Text(text = label.uppercase(), style = KlinaraType.label, color = colors.charcoalMuted)

        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        ) {
            // "Renksiz" ilk sırada: varsayılan seçim odur ve bir seçeneği listeden
            // çıkarıp "boş bırak" demek, kullanıcıya görünmeyen bir yol bırakmaktır.
            Swatch(
                hex = null,
                isSelected = selected == null,
                onClick = { onSelect(null) },
            )

            PALETTE.forEach { hex ->
                Swatch(
                    hex = hex,
                    isSelected = selected?.equals(hex, ignoreCase = true) == true,
                    onClick = { onSelect(hex) },
                )
            }

            // Paletin DIŞINDAKİ kayıtlı renk (web-admin'den ya da eski bir kayıttan):
            // gösterilmezse hiçbir örnek seçili görünmez ve kullanıcı rengin "renksiz"
            // olduğunu sanar. Seçili durur; başka bir örneğe dokunmak onu değiştirir.
            if (selected != null && PALETTE.none { it.equals(selected, ignoreCase = true) }) {
                Swatch(hex = selected, isSelected = true, onClick = {})
            }
        }
    }
}

@Composable
private fun Swatch(
    hex: String?,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val fill = hex?.removePrefix("#")?.toLongOrNull(RADIX)?.let { Color(it or OPAQUE) } ?: colors.disabled
    val description = if (hex == null) "Renksiz" else PALETTE_NAMES[hex.uppercase()] ?: "Özel renk $hex"

    Column(
        modifier =
            Modifier
                .semantics {
                    contentDescription = description
                    this.selected = isSelected
                }.klinaraClickable(true, Role.RadioButton, interactionSource, onClick),
    ) {
        Column(
            modifier =
                Modifier
                    .size(SWATCH_SIZE)
                    .background(fill, CircleShape)
                    .border(
                        width = if (isSelected) SELECTED_BORDER else KlinaraMetrics.borderWidth,
                        color = if (isSelected) colors.charcoal else colors.border,
                        shape = CircleShape,
                    ),
            content = {},
        )
    }
}

/**
 * Palet — marka token'larıyla hizalı, hepsi hem açık hem koyu temada okunur.
 *
 * Hex'ler burada tekrar ediliyor çünkü bunlar **veri**, tema değil: sunucuya yazılıp
 * web-admin'de de aynı görünmeleri gerekiyor. `KlinaraColors` bir tema kaynağıdır ve
 * temaya göre değişir; etiket rengi değişmemeli.
 */
private val PALETTE =
    listOf("#7F9A76", "#5E7856", "#A6483C", "#C08A2E", "#3F6E8C", "#6B5B95", "#6E7A74")

private val PALETTE_NAMES =
    mapOf(
        "#7F9A76" to "Adaçayı",
        "#5E7856" to "Koyu adaçayı",
        "#A6483C" to "Kiremit",
        "#C08A2E" to "Amber",
        "#3F6E8C" to "Mavi",
        "#6B5B95" to "Mor",
        "#6E7A74" to "Gri",
    )

private const val RADIX = 16
private const val OPAQUE = 0xFF000000L
private val SWATCH_SIZE = 36.dp
private val SELECTED_BORDER = 3.dp
