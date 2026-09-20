package com.klinara.android.designsystem.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Üst çubuğun "⋮" menüsü — iOS `ellipsis.circle` `Menu` paritesi. Ekrana ikincil
 * görünüm seçenekleri ("Pasifleri göster") taşır; birincil aksiyon FAB'dadır.
 *
 * [content] menü kapanışını `dismiss` ile tetikleyebilir.
 */
@Composable
fun KlinaraOverflowMenu(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.(dismiss: () -> Unit) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier = modifier) {
        IconButton(onClick = { expanded = true }) {
            Icon(Icons.Filled.MoreVert, contentDescription = "Diğer seçenekler", tint = KlinaraTheme.colors.sageDeep)
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        ) {
            content { expanded = false }
        }
    }
}

/** Açık/kapalı bir görünüm seçeneği — seçiliyken sağında onay işareti. */
@Composable
fun KlinaraCheckMenuItem(
    label: String,
    isChecked: Boolean,
    onToggle: (Boolean) -> Unit,
) {
    val colors = KlinaraTheme.colors
    DropdownMenuItem(
        text = { Text(label, style = KlinaraType.bodyL, color = colors.charcoal) },
        onClick = { onToggle(!isChecked) },
        trailingIcon =
            if (isChecked) {
                {
                    Icon(
                        Icons.Filled.Check,
                        contentDescription = "Açık",
                        tint = colors.sageDeep,
                        modifier = Modifier.size(18.dp),
                    )
                }
            } else {
                null
            },
    )
}
