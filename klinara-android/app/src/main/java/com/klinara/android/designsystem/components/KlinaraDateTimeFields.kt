package com.klinara.android.designsystem.components

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.TurkishLocale
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Gün içi saat alanı (A7.3) — iOS `KlinaraTimeField`. Satıra dokunmak M3 `TimePicker`'ı
 * (24 saat) bir diyalogda açar.
 *
 * **Saat dilimi bilmez**: değer bir duvar saati (`LocalTime`) — çalışma saatleri şubenin
 * duvar saatidir ve dönüşüm çağıranda (`BranchClock`) yapılır. `services/`'e bağımlı değil
 * (A5.1 kuralı): `ClockTime` çevirisi de çağıranda.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KlinaraTimeField(
    label: String,
    value: LocalTime?,
    onValueChange: (LocalTime) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    error: String? = null,
) {
    var isOpen by rememberSaveable { mutableStateOf(false) }
    val text = value?.format(TIME) ?: "—"

    PickerRow(label = label, value = text, enabled = enabled, error = error, modifier = modifier) { isOpen = true }

    if (isOpen) {
        val initial = value ?: LocalTime.of(DEFAULT_HOUR, 0)
        val state = rememberTimePickerState(initialHour = initial.hour, initialMinute = initial.minute, is24Hour = true)
        AlertDialog(
            onDismissRequest = { isOpen = false },
            title = { Text(label, style = KlinaraType.titleM) },
            text = {
                TimePicker(
                    state = state,
                    colors =
                        // M3 varsayılanı seçili olmayan saat/dakika kutusunu mor (`secondaryContainer`)
                        // boyuyor; marka paletinde öyle bir ton yok.
                        TimePickerDefaults.colors(
                            clockDialColor = KlinaraTheme.colors.surface,
                            selectorColor = KlinaraTheme.colors.sage,
                            timeSelectorSelectedContainerColor = KlinaraTheme.colors.sageSoft,
                            timeSelectorUnselectedContainerColor = KlinaraTheme.colors.disabled,
                            timeSelectorSelectedContentColor = KlinaraTheme.colors.charcoal,
                            timeSelectorUnselectedContentColor = KlinaraTheme.colors.charcoal,
                        ),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onValueChange(LocalTime.of(state.hour, state.minute))
                    isOpen = false
                }) { Text("Tamam") }
            },
            dismissButton = { TextButton(onClick = { isOpen = false }) { Text("Vazgeç") } },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        )
    }
}

/**
 * Tarih alanı (A7.3) — M3 `DatePicker` diyaloğu.
 *
 * ⚠️ `DatePicker` seçimi **UTC gece yarısının milisaniyesi** olarak verir. Bunu cihaz ya da
 * şube dilimiyle `Instant`'a çevirmek, UTC'nin gerisindeki bir dilimde bir gün öncesini
 * seçtirir. Dönüşüm tek yerde, [DatePickerMillis]'te ve birim testli; alan yalnız
 * `LocalDate` konuşur.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KlinaraDateField(
    label: String,
    value: LocalDate,
    onValueChange: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    minDate: LocalDate? = null,
    error: String? = null,
) {
    var isOpen by rememberSaveable { mutableStateOf(false) }

    PickerRow(label = label, value = value.format(DATE), enabled = enabled, error = error, modifier = modifier) {
        isOpen = true
    }

    if (isOpen) {
        val selectable =
            remember(minDate) {
                object : SelectableDates {
                    override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                        minDate == null || DatePickerMillis.toDate(utcTimeMillis) >= minDate
                }
            }
        val state =
            rememberDatePickerState(
                initialSelectedDateMillis = DatePickerMillis.fromDate(value),
                selectableDates = selectable,
            )
        DatePickerDialog(
            onDismissRequest = { isOpen = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { onValueChange(DatePickerMillis.toDate(it)) }
                    isOpen = false
                }) { Text("Tamam") }
            },
            dismissButton = { TextButton(onClick = { isOpen = false }) { Text("Vazgeç") } },
            colors = DatePickerDefaults.colors(containerColor = KlinaraTheme.colors.surfaceRaised),
        ) {
            DatePicker(state = state, showModeToggle = false)
        }
    }
}

/** `DatePicker`'ın UTC-milisaniye ↔ `LocalDate` çevirisi — dilimden bağımsız, tek doğru yol. */
object DatePickerMillis {
    fun fromDate(date: LocalDate): Long = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

    fun toDate(utcMillis: Long): LocalDate = Instant.ofEpochMilli(utcMillis).atZone(ZoneOffset.UTC).toLocalDate()
}

@Composable
private fun PickerRow(
    label: String,
    value: String,
    enabled: Boolean,
    error: String?,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember { MutableInteractionSource() }
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = "$label, $value" }
                    .klinaraClickable(enabled, Role.Button, interaction, onClick)
                    .padding(vertical = KlinaraMetrics.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label,
                style = KlinaraType.bodyL,
                color = if (enabled) colors.charcoal else colors.charcoalMuted,
                modifier = Modifier.weight(1f),
            )
            Text(
                value,
                style = KlinaraType.bodyEmphasis,
                color = if (enabled) colors.sageDeep else colors.charcoalMuted,
            )
        }
        if (error != null) FieldErrorText(error)
    }
}

private const val DEFAULT_HOUR = 9
private val TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
private val DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMMM yyyy, EEEE", TurkishLocale)
