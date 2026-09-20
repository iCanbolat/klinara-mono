package com.klinara.android.features.calendar

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.DensityLegend
import com.klinara.android.designsystem.components.DensityStrip
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.FabContentClearance
import com.klinara.android.designsystem.components.KlinaraFab
import com.klinara.android.designsystem.components.KlinaraFabBox
import com.klinara.android.designsystem.components.KlinaraFilterPill
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
 * "Takvim" sekmesinin kökü.
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

    KlinaraFabBox(
        fab = onCreate?.let { create -> { KlinaraFab(contentDescription = "Yeni randevu", onClick = create) } },
        modifier = modifier,
    ) {
    KlinaraScreen(
        title = title,
        // Hafta ızgarası kendi kaydırmasını kurar; dış kaydırma iç kaydırmayı yutar.
        scrollable = state.mode != CalendarMode.Week,
        contentPadding = CalendarContentPadding,
        verticalSpacing = KlinaraMetrics.md,
        trailing = trailing,
    ) {
        CalendarHeader(clock = clock, state = state, viewModel = viewModel, now = now)

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

            is Loadable.Loaded -> {
                // Yenilenirken eski gün, yeni tarihin altında tam opak durursa başka günün
                // randevusu bu güne aitmiş gibi okunur; sönük ve dokunulamaz çizilir.
                val bodyAlpha by animateFloatAsState(
                    targetValue = if (state.isRefreshing) REFRESHING_ALPHA else 1f,
                    label = "refresh",
                )
                Box(modifier = Modifier.alpha(bodyAlpha)) {
                CalendarBody(
                    clock = clock,
                    state = state,
                    onSelect = { entry: CalendarEntry -> if (!state.isRefreshing) onSelectAppointment(entry.id) },
                    onSelectDay = viewModel::select,
                    now = now,
                    onCreate = onCreate,
                )
                }
            }
        }

        if (state.mode != CalendarMode.Week && onCreate != null) Spacer(Modifier.height(FabContentClearance))
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
    onCreate: (() -> Unit)?,
) {
    when (state.mode) {
        CalendarMode.Agenda ->
            AgendaListScreen(
                clock = clock,
                active = state.activeEntries,
                terminal = state.terminalEntries,
                staffColor = state::staffColor,
                onSelect = onSelect,
                onCreate = onCreate,
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
        // Mod seçici ilk satırda: altındaki gezinme satırının ne kaydırdığı (gün mü
        // hafta mı) önce burada belirleniyor.
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        ) {
            KlinaraSegmentedPicker(
                options = CalendarMode.entries,
                selected = state.mode,
                onSelect = viewModel::setMode,
                title = { it.turkishName },
                modifier = Modifier.weight(1f),
                icon = { painterResource(it.iconRes) },
            )

            // "Bugün" yalnız bugünde DEĞİLKEN görünür: her zaman duran bir düğme,
            // basıldığında hiçbir şey olmayan bir düğme olurdu. Seçicinin yanında
            // durur ki gezinme satırının genişliği hiç değişmesin.
            // Yalnız bugünde DEĞİLKEN yer kaplar. Genişleme animasyonu yok: seçici
            // genişliğinin animasyonla daralıp açılması geçişlerde titreme gibi okunuyordu.
            if (!clock.isToday(state.selectedDate, now)) {
                TodayButton(enabled = true, onClick = { viewModel.goToToday(now) })
            }
        }

        // Oklar kaydırdıkları şeyin iki yanında: gün modlarında şeridin, hafta
        // modunda hafta aralığının.
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

            if (state.mode == CalendarMode.Week) {
                val days = clock.weekDays(state.selectedDate)
                Text(
                    text = "${clock.dayNumber(days.first())} – ${clock.formatDate(days.last())}",
                    style = KlinaraType.bodyEmphasis,
                    color = KlinaraTheme.colors.charcoal,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            } else {
                CalendarDateStrip(
                    clock = clock,
                    selected = state.selectedDate,
                    dayCounts = state.densityByDay.mapValues { (_, hours) -> hours.values.sum() },
                    onSelect = viewModel::select,
                    modifier = Modifier.weight(1f),
                    now = now,
                )
            }

            StepButton(
                icon = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                label = state.mode.nextLabel,
                onClick = { viewModel.step(1) },
            )
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
    val colors = KlinaraTheme.colors

    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KlinaraFilterPill(label = "Tümü", isSelected = state.staffFilter == null, onClick = {
            onToggle(state.staffFilter)
        })
        staff.forEach { profile ->
            KlinaraFilterPill(
                label = profile.userFullName,
                isSelected = state.staffFilter == profile.id,
                dotColor = accentColor(profile.calendarColor, colors.sage),
                onClick = { onToggle(profile.id) },
            )
        }
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
private fun TodayButton(
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier =
            modifier
                .heightIn(min = KlinaraMetrics.minTouchTarget)
                .klinaraClickable(
                    enabled = enabled,
                    role = Role.Button,
                    interactionSource = interaction,
                    onClick = onClick,
                ).clearAndSetSemantics {
                    if (enabled) {
                        contentDescription = "Bugüne dön"
                        role = Role.Button
                    } else {
                        hideFromAccessibility()
                    }
                }.padding(horizontal = KlinaraMetrics.xs),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = "Bugün", style = KlinaraType.bodyEmphasis, color = colors.sageDeep, maxLines = 1)
    }
}

/**
 * Tüm modlarda AYNI dolgu. Önceden ajanda 24 dp, ızgaralar 16 dp kullanıyordu; mod
 * değişince başlık, şerit ve çipler yana kayıyor ve geçiş "titriyor" gibi görünüyordu.
 * 16 dp ızgaranın okunabilirliği için gereken değer, ajanda kartları da bunu taşıyor.
 */
private val CalendarContentPadding =
    PaddingValues(
        start = KlinaraMetrics.md,
        end = KlinaraMetrics.md,
        top = KlinaraMetrics.md,
        bottom = KlinaraMetrics.xl,
    )

private const val REFRESHING_ALPHA = 0.35f
