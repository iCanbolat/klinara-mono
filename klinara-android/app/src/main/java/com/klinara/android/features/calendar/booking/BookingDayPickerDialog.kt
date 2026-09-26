package com.klinara.android.features.calendar.booking

import android.content.res.Configuration
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalConfiguration
import com.klinara.android.services.formatting.TrLocale
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.services.booking.AvailabilityDay
import com.klinara.android.services.booking.AvailabilityDayStatus
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneOffset

/**
 * Randevu gününü takvimden seçme (iOS `BookingDayPickerSheet` paritesi).
 *
 * Kapalı / tatil / geçmiş / pencere dışı günler `GET availability/days` ile baştan
 * SEÇİLEMEZ. Material `DatePicker` milisaniyeleri UTC gece yarısı olarak veriyor; bu
 * yüzden çevrim `ZoneOffset.UTC` ile yapılıyor — şube saat dilimi burada karışmıyor,
 * `LocalDate` zaten şubenin yerel günü.
 *
 * [SelectableDates] bir Compose durumunu ([days]) okuyor: ay yüklendikçe gün hücreleri
 * yeniden çiziliyor. Yüklenmemiş gün seçilebilir kabul ediliyor — ağ yavaşsa takvim
 * kilitlenmemeli; seçilen gün zaten nedeniyle açıklanıyor.
 */
@Composable
fun BookingDayPickerDialog(
    initial: LocalDate,
    today: LocalDate,
    days: Map<String, AvailabilityDay>,
    onMonth: (YearMonth) -> Unit,
    onPick: (LocalDate) -> Unit,
    onDismiss: () -> Unit,
) {
    // Material `DatePicker` ay/gün adlarını ve haftanın ilk gününü cihaz dilinden
    // alıyor (durum oluşturulurken de); panel Türkçe, takvim Türkçe ve pazartesi
    // başlangıçlı olmalı. Sağlayıcı durumu da kapsamalı, yalnız çizimi değil.
    val base = LocalConfiguration.current
    val turkish = remember(base) { Configuration(base).apply { setLocale(TrLocale) } }
    CompositionLocalProvider(LocalConfiguration provides turkish) {
        DayPickerContent(initial, today, days, onMonth, onPick, onDismiss)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DayPickerContent(
    initial: LocalDate,
    today: LocalDate,
    days: Map<String, AvailabilityDay>,
    onMonth: (YearMonth) -> Unit,
    onPick: (LocalDate) -> Unit,
    onDismiss: () -> Unit,
) {
    val currentDays by rememberUpdatedState(days)
    val selectable =
        object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                val date = utcTimeMillis.toLocalDate()
                if (date.isBefore(today)) return false
                val status = currentDays[date.toString()]?.status ?: return true
                return status == AvailabilityDayStatus.Open || status == AvailabilityDayStatus.Unknown
            }

            override fun isSelectableYear(year: Int): Boolean = year in today.year..today.year + 1
        }
    val state =
        rememberDatePickerState(
            initialSelectedDateMillis = initial.toUtcMillis(),
            initialDisplayedMonthMillis = initial.withDayOfMonth(1).toUtcMillis(),
            yearRange = today.year..today.year + 1,
            selectableDates = selectable,
        )

    // Görünen ay değişince o ayın durumları istenir (ilk açılış dahil).
    LaunchedEffect(state) {
        snapshotFlow { state.displayedMonthMillis }.collect { millis ->
            onMonth(YearMonth.from(millis.toLocalDate()))
        }
    }

    val colors = KlinaraTheme.colors
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            // İlk seçili gün (ör. saatleri geçmiş bugün) seçilemez olabilir; o gün
            // onaylanamasın.
            val selected = state.selectedDateMillis
            TextButton(
                enabled = selected != null && selectable.isSelectableDate(selected),
                onClick = { state.selectedDateMillis?.let { onPick(it.toLocalDate()) } },
            ) { Text("Seç", style = KlinaraType.button, color = colors.sageDeep) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Vazgeç", style = KlinaraType.button, color = colors.charcoalMuted)
            }
        },
        colors = DatePickerDefaults.colors(containerColor = colors.surfaceRaised),
    ) {
        Column {
        DatePicker(
            state = state,
            title = null,
            headline = null,
            showModeToggle = false,
            colors =
                DatePickerDefaults.colors(
                    containerColor = colors.surfaceRaised,
                    selectedDayContainerColor = colors.sageDeep,
                    selectedDayContentColor = colors.surfaceRaised,
                    todayDateBorderColor = colors.sage,
                    todayContentColor = colors.sageDeep,
                    dayContentColor = colors.charcoal,
                    disabledDayContentColor = colors.charcoalMuted.copy(alpha = 0.35f),
                    weekdayContentColor = colors.charcoalMuted,
                    navigationContentColor = colors.charcoal,
                    subheadContentColor = colors.charcoalMuted,
                    selectedYearContainerColor = colors.sageDeep,
                ),
        )
        DayLegend(
            holidays = days.values.filter { it.status == AvailabilityDayStatus.Holiday && it.date.startsWith(YearMonth.from(state.displayedMonthMillis.toLocalDate()).toString()) },
            danger = colors.danger,
            muted = colors.charcoalMuted,
        )
        }
    }
}

/**
 * Material `DatePicker` hücreleri süslenemiyor; tatil günlerinin adı takvimin altında
 * listeleniyor ki "neden seçemiyorum" sorusu cevapsız kalmasın.
 */
@Composable
private fun DayLegend(
    holidays: List<AvailabilityDay>,
    danger: Color,
    muted: Color,
) {
    if (holidays.isEmpty()) {
        Text(
            "Soluk günler kapalı, tatil ya da rezervasyona kapalı.",
            style = KlinaraType.bodyM,
            color = muted,
            modifier = Modifier.padding(horizontal = KlinaraMetrics.lg, vertical = KlinaraMetrics.xs),
        )
        return
    }
    holidays.sortedBy { it.date }.forEach { day ->
        Row(
            modifier = Modifier.padding(horizontal = KlinaraMetrics.lg, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            Box(Modifier.size(6.dp).background(danger, CircleShape))
            Text(
                "${LocalDate.parse(day.date).dayOfMonth} · ${day.holidayName ?: "Tatil"}",
                style = KlinaraType.bodyM,
                color = muted,
            )
        }
    }
}

private fun Long.toLocalDate(): LocalDate = Instant.ofEpochMilli(this).atZone(ZoneOffset.UTC).toLocalDate()

private fun LocalDate.toUtcMillis(): Long = atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
