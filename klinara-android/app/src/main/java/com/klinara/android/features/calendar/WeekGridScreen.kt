package com.klinara.android.features.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.CalendarGridMetrics
import com.klinara.android.designsystem.components.DensityLegend
import com.klinara.android.designsystem.components.DensityScale
import com.klinara.android.designsystem.components.WeekBlockView
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.services.booking.CalendarEntry
import com.klinara.android.services.formatting.BranchClock
import java.time.Instant

/**
 * Haftanın yedi günü, tek ızgarada.
 *
 * **Yatay kaydırma YOK**: yedi sütun ekrana sığar ve kaydırma, kullanıcının haftanın
 * tamamını göremediği bir hafta görünümü üretirdi. Sütunlar dar; bu yüzden bloklar
 * yalnız bir başlık taşır ve tam bilgi `contentDescription`'da kalır.
 *
 * Saat aralığı **yedi günün TAMAMI** üzerinden hesaplanır: sütunlar tek bir cetveli
 * paylaşıyor, her sütunun kendi aralığı olsaydı aynı yükseklik farklı saatler
 * demek olurdu.
 *
 * Kendi dikey kaydırmasını kurar (gün başlıkları sabit kalmalı); `CalendarHomeScreen`
 * bu modda dış kaydırmayı kapatıyor — iki iç içe dikey kaydırma Compose'da çalışmaz.
 */
@Composable
fun WeekGridScreen(
    clock: BranchClock,
    days: List<Instant>,
    selectedDay: Instant,
    entries: List<CalendarEntry>,
    densityByDay: Map<String, Map<Int, Int>>,
    densityPeak: Int,
    densityNote: String?,
    staffColor: (String?) -> String?,
    onSelect: (CalendarEntry) -> Unit,
    onSelectDay: (Instant) -> Unit,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
) {
    val hours = CalendarBlockLayout.hourRange(entries, clock)
    val hourHeight = CalendarBlockLayout.HOUR_HEIGHT.dp

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        DayHeader(clock, days, selectedDay, densityByDay, onSelectDay, now)

        if (densityPeak > 0) {
            DensityLegend(peak = densityPeak, note = densityNote)
        }

        Column(modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            // Saat etiketleri kendi çizgilerine hizalanmak için yukarı çekiliyor;
            // dolgu olmadan ilk etiket ızgaranın üstünde kırpılıyor.
            Box(modifier = Modifier.height(LABEL_BASELINE_INSET))
            Row(
                modifier = Modifier.fillMaxWidth().height(hourHeight * hours.count()),
                horizontalArrangement = Arrangement.spacedBy(CalendarGridMetrics.columnSpacing),
            ) {
                HourLabels(hours, hourHeight)
                days.forEach { day ->
                    DayColumn(
                        clock = clock,
                        day = day,
                        hours = hours,
                        hourHeight = hourHeight,
                        entries = entries.filter { clock.isSameDay(it.startsAt, day) },
                        counts = densityByDay[clock.localDateString(day)].orEmpty(),
                        densityPeak = densityPeak,
                        staffColor = staffColor,
                        onSelect = onSelect,
                        now = now,
                    )
                }
            }
            // Alt gezinme çubuğunun altında kalan son saat okunabilsin.
            Box(modifier = Modifier.height(KlinaraMetrics.xxl))
        }
    }
}

@Composable
private fun DayHeader(
    clock: BranchClock,
    days: List<Instant>,
    selectedDay: Instant,
    densityByDay: Map<String, Map<Int, Int>>,
    onSelectDay: (Instant) -> Unit,
    now: Instant,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(CalendarGridMetrics.columnSpacing),
    ) {
        // Izgara iskeletini birebir aynalayan boşluk: gün başlığı kendi sütununun
        // üstünde durmazsa hafta okunmaz hâle gelir.
        Box(modifier = Modifier.width(CalendarGridMetrics.weekRulerWidth))

        days.forEach { day ->
            DayHeaderCell(
                clock = clock,
                day = day,
                isSelected = clock.isSameDay(day, selectedDay),
                isToday = clock.isToday(day, now),
                count = densityByDay[clock.localDateString(day)]?.values?.sum(),
                onSelectDay = onSelectDay,
            )
        }
    }
}

@Composable
private fun RowScope.DayHeaderCell(
    clock: BranchClock,
    day: Instant,
    isSelected: Boolean,
    isToday: Boolean,
    count: Int?,
    onSelectDay: (Instant) -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember(day) { MutableInteractionSource() }

    val label =
        buildString {
            append(clock.formatDate(day))
            if (count != null) append(if (count > 0) ", $count randevu" else ", randevu yok")
        }

    Column(
        modifier =
            Modifier
                .weight(1f)
                .background(
                    if (isSelected) colors.sageSoft else colors.surface,
                    RoundedCornerShape(KlinaraMetrics.xs),
                ).klinaraClickable(
                    enabled = true,
                    role = Role.Button,
                    interactionSource = interaction,
                    // Güne dokunmak SEÇİMİ taşır, modu DEĞİŞTİRMEZ: kullanıcı hafta
                    // görünümünde kalmak isteyip istemediğine kendisi karar verir.
                    onClick = { onSelectDay(day) },
                ).clearAndSetSemantics {
                    contentDescription = label
                    selected = isSelected
                    role = Role.Button
                }.padding(vertical = KlinaraMetrics.xs),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            clock.weekdayInitial(day).uppercase(TrLocaleTag),
            style = KlinaraType.label,
            color = colors.charcoalMuted,
            maxLines = 1,
        )
        Text(
            clock.dayNumber(day),
            style = KlinaraType.bodyM,
            fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal,
            color = if (isToday) colors.sageDeep else colors.charcoal,
            maxLines = 1,
        )
    }
}

@Composable
private fun HourLabels(
    hours: IntRange,
    hourHeight: androidx.compose.ui.unit.Dp,
) {
    val colors = KlinaraTheme.colors
    Column(modifier = Modifier.width(CalendarGridMetrics.weekRulerWidth)) {
        hours.forEach { hour ->
            Text(
                text = "%02d:00".format(hour),
                style = KlinaraType.label,
                color = colors.charcoalMuted,
                maxLines = 1,
                modifier =
                    Modifier
                        .height(hourHeight)
                        // Etiket kendi saat çizgisiyle hizalansın; ortalanırsa bir
                        // sonraki saate ait görünür.
                        .offset(y = LABEL_LIFT),
            )
        }
    }
}

@Composable
private fun RowScope.DayColumn(
    clock: BranchClock,
    day: Instant,
    hours: IntRange,
    hourHeight: androidx.compose.ui.unit.Dp,
    entries: List<CalendarEntry>,
    counts: Map<Int, Int>,
    densityPeak: Int,
    staffColor: (String?) -> String?,
    onSelect: (CalendarEntry) -> Unit,
    now: Instant,
) {
    val colors = KlinaraTheme.colors
    val dayName = clock.formatDate(day)

    BoxWithConstraints(modifier = Modifier.weight(1f)) {
        val columnWidth = maxWidth

        Column {
            hours.forEach { hour ->
                val count = counts[hour] ?: 0
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .height(hourHeight)
                            .background(DensityScale.backgroundColor(count, densityPeak, colors))
                            .clearAndSetSemantics {
                                contentDescription = "$dayName %02d:00, %d randevu".format(hour, count)
                            },
                ) {
                    // Saat çizgisi hücrenin ÜST kenarında; ızgaranın yatay çizgileri
                    // bunlar ve blokların altında kalıyorlar.
                    Box(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .height(KlinaraMetrics.borderWidth)
                                .background(colors.border),
                    )
                }
            }
        }

        CalendarBlockLayout
            .place(
                entries = entries,
                clock = clock,
                originMinutes = hours.first * MINUTES_PER_HOUR,
                width = columnWidth.value,
                // Sütunlar zaten dar; gün ızgarasındaki nefes payı burada bir blok
                // genişliği kadar yer yerdi.
                gutter = 0f,
            ).forEach { placed ->
                WeekBlockView(
                    title = placed.entry.customerName,
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

        nowOffset(clock, day, hours, now)?.let { offset ->
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .offset(y = offset.dp)
                        .height(NOW_RULE_HEIGHT)
                        .background(colors.danger),
            )
        }
    }
}

private const val MINUTES_PER_HOUR = 60
/**
 * Saat etiketini kendi çizgisiyle hizalar.
 *
 * Metin kutusu yazı tipinin üst boşluğunu taşıyor; kaldırmadan bırakılırsa etiket bir
 * sonraki saate ait görünüyor. Negatif çünkü YUKARI çekiyor.
 */
private val LABEL_BASELINE_INSET = 5.dp
private val LABEL_LIFT = -LABEL_BASELINE_INSET
private val NOW_RULE_HEIGHT = 1.5.dp
