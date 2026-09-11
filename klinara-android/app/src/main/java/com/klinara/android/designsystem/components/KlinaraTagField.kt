package com.klinara.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Serbest etiket listesi girişi — personelin uzmanlıkları (A7.2). iOS `KlinaraTagField`.
 *
 * Yazılan metin klavyenin "Bitti"siyle eklenir; boşluklar kırpılır, aynısı (büyük/küçük harf
 * gözetmeden) ikinci kez eklenmez. Etikete dokunmak onu **kaldırır** ve ekran okuyucuya
 * "… kaldır" diye duyurulur — iOS'ta da dokunuş kaldırıyor ama bunu söyleyen bir ipucu yok.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun KlinaraTagField(
    label: String,
    tags: List<String>,
    onTagsChange: (List<String>) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Yazıp klavyede Bitti'ye basın",
    enabled: Boolean = true,
    maxLength: Int = MAX_TAG_LENGTH,
) {
    var draft by rememberSaveable { mutableStateOf("") }

    fun commit() {
        val value = draft.trim().take(maxLength)
        if (value.isNotEmpty() && tags.none { it.equals(value, ignoreCase = true) }) onTagsChange(tags + value)
        draft = ""
    }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
        if (enabled) {
            KlinaraTextField(
                label = label,
                value = draft,
                onValueChange = { draft = it },
                placeholder = placeholder,
                imeAction = ImeAction.Done,
                onSubmit = ::commit,
            )
        } else {
            Text(label.uppercase(), style = KlinaraType.label, color = KlinaraTheme.colors.charcoalMuted)
        }
        if (tags.isEmpty() && !enabled) {
            Text("—", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
        }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            tags.forEach { tag ->
                RemovableTag(text = tag, enabled = enabled, onRemove = { onTagsChange(tags - tag) })
            }
        }
    }
}

@Composable
private fun RemovableTag(
    text: String,
    enabled: Boolean,
    onRemove: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(TAG_RADIUS)
    Text(
        text = if (enabled) "$text  ×" else text,
        style = KlinaraType.bodyM,
        color = colors.charcoal,
        modifier =
            Modifier
                .semantics { if (enabled) contentDescription = "$text kaldır" }
                .background(colors.sageSoft, shape)
                .border(KlinaraMetrics.borderWidth, colors.border, shape)
                .klinaraClickable(enabled, Role.Button, interaction, onRemove)
                .padding(horizontal = KlinaraMetrics.md, vertical = KlinaraMetrics.sm),
    )
}

private const val MAX_TAG_LENGTH = 100
private val TAG_RADIUS = 10.dp
