package com.klinara.android.designsystem.components

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.TurkishLocale

/**
 * Seçilebilir liste satırı — başlık + detay + seçiliyse onay işareti.
 *
 * `BookingFlowScreen` aynı satırı özel olarak yazmıştı; A5'te paket, hizmet, hak ve
 * müşteri seçimi olarak dört yeni çağıran doğunca buraya taşındı. Satır TEK düğüm olarak
 * duyurulur ve seçili durumu `selected` semantiğiyle taşır — yalnız bir onay ikonuyla
 * değil (WCAG 1.4.1).
 */
@Composable
fun KlinaraSelectableRow(
    title: String,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    detail: String? = null,
    enabled: Boolean = true,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val description = listOfNotNull(title, detail).joinToString(", ")

    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .klinaraClickable(enabled, Role.Button, interaction, onClick)
                .clearAndSetSemantics {
                    contentDescription = description
                    selected = isSelected
                    role = Role.Button
                }.padding(vertical = KlinaraMetrics.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                style = KlinaraType.bodyEmphasis,
                color =
                    when {
                        !enabled -> colors.charcoalMuted
                        isSelected -> colors.sageDeep
                        else -> colors.charcoal
                    },
            )
            detail?.let { Text(it, style = KlinaraType.bodyM, color = colors.charcoalMuted) }
        }
        if (isSelected) {
            Icon(Icons.Filled.Check, contentDescription = null, tint = colors.sageDeep, modifier = Modifier.size(20.dp))
        }
    }
}

/**
 * Aranabilir tek seçim listesi (iOS `KlinaraSearchablePicker`).
 *
 * Arama **istemcide** ve Türkçe büyük/küçük harf kurallarıyla yapılır ("IŞIL" ↔ "ışıl");
 * sunucu araması gereken listeler (müşteri) bunu kullanmaz, kendi alanını çizer.
 * Seçenek sayısı [searchThreshold]'un altındaysa arama alanı hiç çizilmez — iki
 * seçeneklik bir listede arama kutusu gürültüdür.
 */
@Composable
fun <T> KlinaraSearchablePicker(
    options: List<T>,
    key: (T) -> String,
    label: (T) -> String,
    isSelected: (T) -> Boolean,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    detail: (T) -> String? = { null },
    searchLabel: String = "Ara",
    emptyMessage: String = "Aramanızla eşleşen kayıt yok.",
    searchThreshold: Int = SEARCH_THRESHOLD,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val needle = query.trim().lowercase(TurkishLocale)
    val visible =
        if (needle.isEmpty()) {
            options
        } else {
            options.filter { label(it).lowercase(TurkishLocale).contains(needle) }
        }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
        if (options.size >= searchThreshold) {
            KlinaraTextField(label = searchLabel, value = query, onValueChange = { query = it })
        }
        if (visible.isEmpty()) {
            Text(emptyMessage, style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
        }
        visible.forEachIndexed { index, option ->
            if (index > 0) KlinaraDivider()
            androidx.compose.runtime.key(key(option)) {
                KlinaraSelectableRow(
                    title = label(option),
                    detail = detail(option),
                    isSelected = isSelected(option),
                    onClick = { onSelect(option) },
                )
            }
        }
    }
}

/**
 * Form içi anahtar satırı — etiket + detay + `Switch`.
 *
 * Material3 `Switch` taşıyıcı olarak kullanılıyor, renkleri marka token'larına bağlı.
 * Satırın tamamı dokunulabilir ve TEK düğüm olarak "açık/kapalı" durumuyla duyurulur.
 */
@Composable
fun KlinaraToggleRow(
    label: String,
    isOn: Boolean,
    onToggle: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    detail: String? = null,
    enabled: Boolean = true,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .klinaraClickable(enabled, Role.Switch, interaction) { onToggle(!isOn) }
                .clearAndSetSemantics {
                    contentDescription = listOfNotNull(label, detail).joinToString(", ")
                    stateDescription = if (isOn) "Açık" else "Kapalı"
                    role = Role.Switch
                }.padding(vertical = KlinaraMetrics.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                label,
                style = KlinaraType.bodyEmphasis,
                color = if (enabled) colors.charcoal else colors.charcoalMuted,
            )
            detail?.let { Text(it, style = KlinaraType.bodyM, color = colors.charcoalMuted) }
        }
        Switch(
            checked = isOn,
            onCheckedChange = null,
            enabled = enabled,
            colors =
                SwitchDefaults.colors(
                    checkedTrackColor = colors.sage,
                    checkedThumbColor = colors.surfaceRaised,
                    uncheckedTrackColor = colors.disabled,
                    uncheckedThumbColor = colors.surfaceRaised,
                    uncheckedBorderColor = colors.border,
                ),
        )
    }
}

private const val SEARCH_THRESHOLD = 6
