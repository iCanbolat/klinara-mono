package com.klinara.android.features.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ColorDot
import com.klinara.android.designsystem.components.DensityLegend
import com.klinara.android.designsystem.components.DensityStrip
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.booking.CalendarEntry
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import androidx.compose.runtime.LaunchedEffect
import java.time.Instant

/**
 * "Bugün" sekmesinin kökü.
 *
 * Üç görünüm arasında geçerken **seçili tarih korunur**: tek doğruluk kaynağı
 * `CalendarUiState.selectedDate` ve mod değişimi ona dokunmaz. Haftada bir güne
 * dokunmak da yalnız seçimi taşır, modu değiştirmez — kullanıcı hafta görünümünde
 * kalmak isteyip istemediğine kendisi karar verir.
 */
@Composable
fun CalendarHomeScreen(
    session: AppSession,
    container: ServiceContainer,
    branchGeneration: Int,
    onSelectAppointment: (String) -> Unit,
    modifier: Modifier = Modifier,
    /** null ise kullanıcının `appointment:write` izni yok: düğme HİÇ çizilmez. */
    onCreate: (() -> Unit)? = null,
    trailing: @Composable (RowScope.() -> Unit)? = null,
    now: Instant = Instant.now(),
) {
    val clock = remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }
    val viewModel: CalendarViewModel =
        viewModel(
            key = "calendar-${session.profile.user.id}",
            factory = CalendarViewModel.factory(container, clock),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()

    val branchId = session.activeBranchId
    val loadKey = viewModel.loadKey(branchId, branchGeneration)

    // Tek `LaunchedEffect`, türetilmiş anahtar: ajanda↔gün geçişi ve aynı hafta
    // içindeki gün değişimi ISTEK ATMAZ (anahtarın `scope` alanı değişmiyor).
    LaunchedEffect(loadKey) { viewModel.load(branchId) }
    LaunchedEffect(Unit) { viewModel.loadStaff() }

    val title =
        when (state.mode) {
            CalendarMode.Week -> {
                val days = clock.weekDays(state.selectedDate)
                "${clock.dayNumber(days.first())} – ${clock.formatDate(days.last())}"
            }

            CalendarMode.Agenda, CalendarMode.Day -> clock.formatDate(state.selectedDate)
        }

    KlinaraScreen(
        title = title,
        modifier = modifier,
        // Hafta ızgarası kendi kaydırmasını kurar; dış kaydırma iç kaydırmayı yutar.
        scrollable = state.mode != CalendarMode.Week,
        contentPadding = contentPaddingFor(state.mode),
        verticalSpacing = KlinaraMetrics.md,
        trailing = trailing,
    ) {
        CalendarHeader(clock = clock, state = state, viewModel = viewModel, now = now)

        onCreate?.let {
            KlinaraButton(title = "Yeni randevu", onClick = it, kind = KlinaraButtonKind.Secondary)
        }

        when (val calendar = state.calendar) {
            Loadable.Loading ->
                Text(
                    "Takvim yükleniyor…",
                    style = KlinaraType.bodyM,
                    color = KlinaraTheme.colors.charcoalMuted,
                )

            is Loadable.Failed ->
                ErrorBanner(
                    message = calendar.message,
                    onRetry = if (calendar.isRetryable) ({ viewModel.load(branchId) }) else null,
                )

            is Loadable.Loaded ->
                CalendarBody(
                    clock = clock,
                    state = state,
                    onSelect = { entry: CalendarEntry -> onSelectAppointment(entry.id) },
                    onSelectDay = viewModel::select,
                    now = now,
                )
        }
    }
}

@Composable
private fun CalendarBody(
    clock: BranchClock,
    state: CalendarUiState,
    onSelect: (CalendarEntry) -> Unit,
    onSelectDay: (Instant) -> Unit,
    now: Instant,
) {
    when (state.mode) {
        CalendarMode.Agenda ->
            AgendaListScreen(
                clock = clock,
                active = state.activeEntries,
                terminal = state.terminalEntries,
                staffColor = state::staffColor,
                onSelect = onSelect,
            )

        CalendarMode.Day ->
            Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
                val entries = state.activeEntries + state.terminalEntries
                if (state.densityPeak > 0) {
                    DensityStrip(
                        counts = state.densityByDay[clock.localDateString(state.selectedDate)].orEmpty(),
                        hours = CalendarBlockLayout.hourRange(entries, clock),
                        peak = state.densityPeak,
                    )
                    DensityLegend(peak = state.densityPeak, note = state.densityNote)
                }
                DayGridScreen(
                    clock = clock,
                    day = state.selectedDate,
                    entries = entries,
                    staffColor = state::staffColor,
                    onSelect = onSelect,
                    now = now,
                )
            }

        CalendarMode.Week ->
            WeekGridScreen(
                clock = clock,
                days = clock.weekDays(state.selectedDate),
                selectedDay = state.selectedDate,
                entries = state.activeEntries + state.terminalEntries,
                densityByDay = state.densityByDay,
                densityPeak = state.densityPeak,
                densityNote = state.densityNote,
                staffColor = state::staffColor,
                onSelect = onSelect,
                onSelectDay = onSelectDay,
                now = now,
            )
    }
}

@Composable
private fun CalendarHeader(
    clock: BranchClock,
    state: CalendarUiState,
    viewModel: CalendarViewModel,
    now: Instant,
) {
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
        if (state.mode != CalendarMode.Week) {
            CalendarDateStrip(
                clock = clock,
                selected = state.selectedDate,
                dayCounts = state.densityByDay.mapValues { (_, hours) -> hours.values.sum() },
                onSelect = viewModel::select,
                now = now,
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            StepButton(
                icon = Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                label = state.mode.previousLabel,
                onClick = { viewModel.step(-1) },
            )

            KlinaraSegmentedPicker(
                options = CalendarMode.entries,
                selected = state.mode,
                onSelect = viewModel::setMode,
                title = { it.turkishName },
                modifier = Modifier.weight(1f),
            )

            StepButton(
                icon = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                label = state.mode.nextLabel,
                onClick = { viewModel.step(1) },
            )
        }

        // "Bugün" yalnız bugünde DEĞİLKEN görünür: her zaman duran bir düğme,
        // basıldığında hiçbir şey olmayan bir düğme olurdu.
        if (!clock.isToday(state.selectedDate, now)) {
            TodayButton(onClick = { viewModel.goToToday(now) })
        }

        StaffFilterRow(state = state, onToggle = viewModel::toggleStaffFilter)
    }
}

@Composable
private fun StaffFilterRow(
    state: CalendarUiState,
    onToggle: (String?) -> Unit,
) {
    val staff = state.activeStaff
    if (staff.isEmpty()) return

    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        FilterChip(label = "Tümü", isSelected = state.staffFilter == null, color = null) {
            onToggle(state.staffFilter)
        }
        staff.forEach { profile ->
            FilterChip(
                label = profile.userFullName,
                isSelected = state.staffFilter == profile.id,
                color = profile.calendarColor,
            ) { onToggle(profile.id) }
        }
    }
}

@Composable
private fun FilterChip(
    label: String,
    isSelected: Boolean,
    color: String?,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember(label) { MutableInteractionSource() }

    Row(
        modifier =
            Modifier
                .background(if (isSelected) colors.sageSoft else colors.surfaceRaised, CircleShape)
                .border(
                    if (isSelected) KlinaraMetrics.focusBorderWidth else KlinaraMetrics.borderWidth,
                    if (isSelected) colors.sageDeep else colors.border,
                    CircleShape,
                ).klinaraClickable(
                    enabled = true,
                    role = Role.Button,
                    interactionSource = interaction,
                    onClick = onClick,
                ).clearAndSetSemantics {
                    contentDescription = label
                    selected = isSelected
                    role = Role.Button
                }.padding(horizontal = KlinaraMetrics.sm, vertical = CHIP_VERTICAL_PADDING),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        if (color != null) ColorDot(color = accentColor(color, colors.sage), size = CHIP_DOT_SIZE)
        Text(
            text = label,
            style = KlinaraType.bodyM,
            color = if (isSelected) colors.sageDeep else colors.charcoalMuted,
            maxLines = 1,
        )
    }
}

@Composable
private fun StepButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    val interaction = remember(label) { MutableInteractionSource() }
    Box(
        modifier =
            Modifier
                .size(KlinaraMetrics.minTouchTarget)
                .klinaraClickable(
                    enabled = true,
                    role = Role.Button,
                    interactionSource = interaction,
                    onClick = onClick,
                ).clearAndSetSemantics {
                    contentDescription = label
                    role = Role.Button
                },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = KlinaraTheme.colors.charcoal)
    }
}

@Composable
private fun TodayButton(onClick: () -> Unit) {
    val colors = KlinaraTheme.colors
    val interaction = remember { MutableInteractionSource() }
    Text(
        text = "Bugüne dön",
        style = KlinaraType.bodyEmphasis,
        color = colors.sageDeep,
        modifier =
            Modifier
                .klinaraClickable(
                    enabled = true,
                    role = Role.Button,
                    interactionSource = interaction,
                    onClick = onClick,
                ).padding(vertical = KlinaraMetrics.xs),
    )
}

@Composable
private fun contentPaddingFor(mode: CalendarMode): PaddingValues =
    PaddingValues(
        // Izgara modlarında yatay dolgu daraltılır: 24 dp iki yandan, saat cetveli ve
        // çakışan sütunlar için kalan genişliği okunamaz hâle getiriyordu.
        start = if (mode == CalendarMode.Agenda) KlinaraMetrics.screenInset else KlinaraMetrics.md,
        end = if (mode == CalendarMode.Agenda) KlinaraMetrics.screenInset else KlinaraMetrics.md,
        top = KlinaraMetrics.md,
        bottom = KlinaraMetrics.xl,
    )

private val CHIP_VERTICAL_PADDING = 6.dp
private val CHIP_DOT_SIZE = 8.dp
