package com.klinara.android.features.calendar

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ColorDot
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.services.booking.CalendarEntry
import com.klinara.android.services.formatting.BranchClock

/**
 * Günün randevuları liste olarak — takvimin **varsayılan** görünümü.
 *
 * Izgara yoğunluğu gösterir, ajanda sırayı. Bir resepsiyonistin en sık sorduğu soru
 * "sırada kim var" olduğu için varsayılan bu (iOS'ta da öyle).
 */
@Composable
fun AgendaListScreen(
    clock: BranchClock,
    active: List<CalendarEntry>,
    terminal: List<CalendarEntry>,
    staffColor: (String?) -> String?,
    onSelect: (CalendarEntry) -> Unit,
    modifier: Modifier = Modifier,
    /** Boş gündeki birincil aksiyon. `null` → yazma izni yok, düğme çizilmez. */
    onCreate: (() -> Unit)? = null,
) {
    if (active.isEmpty() && terminal.isEmpty()) {
        EmptyStateView(
            title = "Bu günde randevu yok",
            message = "Başka bir gün seçebilir ya da bugüne yeni bir randevu ekleyebilirsiniz.",
            icon = Icons.Filled.DateRange,
            actionTitle = "Yeni randevu".takeIf { onCreate != null },
            onAction = onCreate,
            modifier = modifier,
        )
        return
    }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.lg),
    ) {
        if (active.isNotEmpty()) {
            KlinaraCard {
                active.forEachIndexed { index, entry ->
                    if (index > 0) KlinaraDivider()
                    AgendaRow(clock, entry, staffColor, onSelect)
                }
            }
        }

        // İptal ve gelmeyenler AYRI kartta ama gizlenmiyor: gelmeyen bir müşteri,
        // günün sonunda aranacak kişidir. Listeden düşürmek o bilgiyi de düşürürdü.
        if (terminal.isNotEmpty()) {
            KlinaraCard(title = "İptal ve gelmeyenler") {
                terminal.forEachIndexed { index, entry ->
                    if (index > 0) KlinaraDivider()
                    AgendaRow(clock, entry, staffColor, onSelect)
                }
            }
        }
    }
}

@Composable
private fun AgendaRow(
    clock: BranchClock,
    entry: CalendarEntry,
    staffColor: (String?) -> String?,
    onSelect: (CalendarEntry) -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember(entry.id) { MutableInteractionSource() }
    val isTerminal = entry.status.isTerminal

    val label =
        buildString {
            append(clock.formatRange(entry.startsAt, entry.endsAt))
            append(", ${entry.customerName}")
            if (entry.serviceSummary.isNotEmpty()) append(", ${entry.serviceSummary}")
            append(", ${entry.status.turkishName}")
        }

    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .klinaraClickable(
                    enabled = true,
                    role = Role.Button,
                    interactionSource = interaction,
                    onClick = { onSelect(entry) },
                ).clearAndSetSemantics {
                    contentDescription = label
                    role = Role.Button
                }.padding(vertical = KlinaraMetrics.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        // Sabit genişlik DEĞİL taban genişlik: `fontScale 2.0`'da "09:00" üç satıra
        // bölünüyordu. Saat, bir randevu satırının en çok okunan parçası.
        Column(modifier = Modifier.widthIn(min = TIME_COLUMN_MIN_WIDTH)) {
            Text(
                clock.formatTime(entry.startsAt),
                style = KlinaraType.bodyEmphasis,
                color = colors.charcoal,
                maxLines = 1,
            )
            Text(
                clock.formatTime(entry.endsAt),
                style = KlinaraType.label,
                color = colors.charcoalMuted,
                maxLines = 1,
            )
        }

        ColorDot(color = accentColor(staffColor(entry.staffProfileIds.firstOrNull()), colors.sage))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = entry.customerName,
                style = KlinaraType.bodyEmphasis,
                color = if (isTerminal) colors.charcoalMuted else colors.charcoal,
                textDecoration = if (isTerminal) TextDecoration.LineThrough else null,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (entry.serviceSummary.isNotEmpty()) {
                Text(
                    text = entry.serviceSummary,
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        KlinaraBadge(text = entry.status.turkishName, tone = entry.status.badgeTone)

        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = colors.charcoalMuted,
        )
    }
}

private val TIME_COLUMN_MIN_WIDTH = 48.dp
