package com.klinara.android.features.calendar

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.components.AppointmentBlockView
import com.klinara.android.designsystem.components.CalendarGridMetrics
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.NowIndicator
import com.klinara.android.designsystem.components.TimeAxisRuler
import com.klinara.android.services.booking.CalendarEntry
import com.klinara.android.services.formatting.BranchClock
import java.time.Instant

/**
 * Günün zaman ızgarası — tek sütun.
 *
 * **Personel başına sütun YOK** (iOS'ta da yok, `calendar/staff` ucu hiç çağrılmıyor):
 * üç telefon genişliğinde bir ızgara okunmaz ve personel ayrımı zaten filtre çipleri
 * ile blok aksanından geliyor.
 *
 * Kendi kaydırmasını KURMAZ — dış `KlinaraScreen` kaydırıyor. İki iç içe dikey kaydırma
 * Compose'da çalışmaz zaten; hafta ızgarası kendi kaydırmasını kurar çünkü orada üst
 * başlık sabit kalmalı.
 */
@Composable
fun DayGridScreen(
    clock: BranchClock,
    day: Instant,
    entries: List<CalendarEntry>,
    staffColor: (String?) -> String?,
    onSelect: (CalendarEntry) -> Unit,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
) {
    if (entries.isEmpty()) {
        EmptyStateView(
            title = "Bu günde randevu yok",
            message = "Başka bir gün seçebilir ya da yeni bir randevu oluşturabilirsiniz.",
            icon = Icons.Filled.DateRange,
            modifier = modifier,
        )
        return
    }

    val colors = KlinaraTheme.colors
    val hours = CalendarBlockLayout.hourRange(entries, clock)
    val hourHeight = CalendarBlockLayout.HOUR_HEIGHT.dp
    val gridHeight = hourHeight * hours.count()
    val rulerWidth = CalendarGridMetrics.dayRulerWidth
    val originMinutes = hours.first * MINUTES_PER_HOUR

    BoxWithConstraints(modifier = modifier.fillMaxWidth().height(gridHeight)) {
        val blockAreaWidth = maxWidth - rulerWidth - KlinaraMetrics.xs

        TimeAxisRuler(hours = hours, hourHeight = hourHeight, rulerWidth = rulerWidth)

        Box(modifier = Modifier.padding(start = rulerWidth + KlinaraMetrics.xs)) {
            CalendarBlockLayout
                .place(
                    entries = entries,
                    clock = clock,
                    originMinutes = originMinutes,
                    width = blockAreaWidth.value,
                    gutter = KlinaraMetrics.sm.value,
                ).forEach { placed ->
                    AppointmentBlockView(
                        title = placed.entry.customerName,
                        subtitle = placed.entry.serviceSummary.ifEmpty { placed.entry.status.turkishName },
                        timeRange = clock.formatRange(placed.entry.startsAt, placed.entry.endsAt),
                        accent = accentColor(staffColor(placed.entry.staffProfileIds.firstOrNull()), colors.sage),
                        isTerminal = placed.entry.status.isTerminal,
                        onClick = { onSelect(placed.entry) },
                        contentDescription = describe(clock, placed.entry),
                        modifier =
                            Modifier
                                .offset(x = placed.x.dp, y = placed.y.dp)
                                .width(placed.width.dp)
                                .height(placed.height.dp),
                    )
                }
        }

        nowOffset(clock, day, hours, now)?.let { offset ->
            NowIndicator(
                modifier =
                    Modifier
                        .padding(start = rulerWidth - NOW_DOT_OVERHANG)
                        .offset(y = offset.dp),
            )
        }
    }
}

/** Izgaranın dışına düşen "şimdi" çizilmez — 08:00'de açılan bir gün ızgarası taşmasın. */
internal fun nowOffset(
    clock: BranchClock,
    day: Instant,
    hours: IntRange,
    now: Instant,
): Float? {
    if (!clock.isSameDay(day, now)) return null
    val minutes = clock.minutesFromMidnight(now) - hours.first * MINUTES_PER_HOUR
    if (minutes < 0 || minutes > hours.count() * MINUTES_PER_HOUR) return null
    return CalendarBlockLayout.offsetFor(minutes)
}

internal fun describe(
    clock: BranchClock,
    entry: CalendarEntry,
): String =
    buildString {
        append(clock.formatRange(entry.startsAt, entry.endsAt))
        append(", ${entry.customerName}")
        if (entry.serviceSummary.isNotEmpty()) append(", ${entry.serviceSummary}")
        append(", ${entry.status.turkishName}")
    }

private const val MINUTES_PER_HOUR = 60
private val NOW_DOT_OVERHANG = 4.dp
