package com.klinara.android.features.shell

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.auth.BranchSummary

/**
 * Üst çubuktaki şube göstergesi ve değiştiricisi.
 *
 * Şube uygulamanın her yerinde geçerli bir kapsamdır (`X-Branch-Id`); yalnız tek bir
 * ekranda değiştirilebilseydi kullanıcı "hangi şubedeyim?" sorusunu her ekranda
 * yeniden sorardı. Bu yüzden kabuğun her sekmesinde duruyor.
 *
 * **Tek şubeli kliniklerde menü açılmaz** — seçenek olmayan bir menü gürültüdür ve
 * dokunulduğunda hiçbir şey olmayan bir kontrol, kullanıcıya uygulamanın bozuk olduğunu
 * söyler.
 */
@Composable
fun BranchMenu(
    session: AppSession,
    onSelect: (BranchSummary) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val activeName = session.activeBranch?.name

    if (!session.canSwitchBranch) {
        BranchLabel(
            name = activeName,
            showsChevron = false,
            modifier = modifier.semantics { contentDescription = "Şube: ${activeName ?: "—"}" },
        )
        return
    }

    Box(modifier = modifier) {
        val interaction = remember { MutableInteractionSource() }
        BranchLabel(
            name = activeName,
            showsChevron = true,
            modifier =
                Modifier
                    .klinaraClickable(true, Role.Button, interaction) { expanded = true }
                    .semantics {
                        contentDescription = "Şube: ${activeName ?: "seçilmedi"}"
                        onClick(label = "Şube değiştir", action = null)
                    },
        )

        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        ) {
            session.switchableBranches.forEach { branch ->
                val isActive = branch.id == session.activeBranchId
                DropdownMenuItem(
                    text = {
                        Text(
                            branch.name,
                            style = KlinaraType.bodyL,
                            color = KlinaraTheme.colors.charcoal,
                        )
                    },
                    onClick = {
                        expanded = false
                        onSelect(branch)
                    },
                    trailingIcon =
                        if (!isActive) {
                            null
                        } else {
                            {
                                Icon(
                                    Icons.Filled.Check,
                                    contentDescription = "Seçili",
                                    tint = KlinaraTheme.colors.sageDeep,
                                    modifier = Modifier.size(CHECK_SIZE),
                                )
                            }
                        },
                )
            }
        }
    }
}

@Composable
private fun BranchLabel(
    name: String?,
    showsChevron: Boolean,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    Row(
        modifier = modifier.padding(horizontal = KlinaraMetrics.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        Icon(
            Icons.Filled.Place,
            contentDescription = null,
            tint = colors.sageDeep,
            modifier = Modifier.size(PIN_SIZE),
        )
        Text(
            name ?: "Şube seçin",
            style = KlinaraType.bodyM,
            color = colors.sageDeep,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = LABEL_MAX_WIDTH),
        )
        if (showsChevron) {
            Icon(
                Icons.Filled.KeyboardArrowDown,
                contentDescription = null,
                tint = colors.sageDeep,
                modifier = Modifier.size(CHEVRON_SIZE),
            )
        }
    }
}

private val PIN_SIZE = 16.dp
private val CHEVRON_SIZE = 18.dp
private val CHECK_SIZE = 18.dp
private val LABEL_MAX_WIDTH = 140.dp
