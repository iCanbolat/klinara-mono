package com.klinara.android.features.scheduling

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.FieldErrorText
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.KlinaraTimeField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.designsystem.components.rememberUnsavedChangesGuard
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.scheduling.Weekday

/**
 * Şube çalışma saatleri (A7.3) — iOS `BranchHoursView` paritesi.
 *
 * Pazartesi'den Pazar'a yedi kart; tek "Kaydet" (PUT tam değiştirme). Taslak kirliyken
 * **şube menüsü gizlenir** (iOS gibi) ve geri çıkış onay ister: kaydedilmemiş bir hafta başka
 * şubeye taşınamaz ve sessizce kaybolmaz. `schedule:write` yoksa salt okunur.
 */
@Composable
fun BranchHoursScreen(
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val branch = session.activeBranch
    if (branch == null) {
        KlinaraScreen(title = "Çalışma saatleri", modifier = modifier, onBack = onBack, trailing = trailing) {
            NoBranchState("Çalışma saatlerini görüntülemek için bir şube seçin.")
        }
        return
    }
    BranchHoursContent(session, container, branch, onBack, modifier, trailing)
}

@Composable
private fun BranchHoursContent(
    session: AppSession,
    container: ServiceContainer,
    branch: BranchSummary,
    onBack: () -> Unit,
    modifier: Modifier,
    trailing: @Composable (RowScope.() -> Unit)?,
) {
    // Anahtar ŞUBEYİ taşır: şube değişince yeni taslak, eskisi başka şubeye kaydedilemez.
    val viewModel: BranchHoursViewModel =
        viewModel(key = "branch-hours-${branch.id}", factory = BranchHoursViewModel.factory(container, branch.id))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canWrite = session.can(Permissions.SCHEDULE_WRITE)
    val isDirty = state.draft?.isDirty == true
    val back = rememberUnsavedChangesGuard(isDirty = isDirty, onLeave = onBack)

    LaunchedEffect(branch.id) { viewModel.load() }

    Box {
        KlinaraScreen(
            title = "Çalışma saatleri",
            modifier = modifier,
            onBack = back,
            trailing = trailing.takeUnless { isDirty },
        ) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }
            Text(
                "Saatler ${branch.name} saat diliminde (${branch.timezone}) gösterilir ve saklanır.",
                style = KlinaraType.bodyM,
                color = KlinaraTheme.colors.charcoalMuted,
            )

            when (val loaded = state.loaded) {
                Loadable.Loading ->
                    KlinaraSkeleton(style = KlinaraSkeletonStyle.rowsLong)
                is Loadable.Failed ->
                    ErrorBanner(message = loaded.message, onRetry = if (loaded.isRetryable) viewModel::load else null)
                is Loadable.Loaded -> {
                    val draft = state.draft ?: return@KlinaraScreen
                    if (state.didSave) {
                        Text(
                            "Çalışma saatleri kaydedildi.",
                            style = KlinaraType.bodyM,
                            color = KlinaraTheme.colors.sageDeep,
                        )
                    }
                    Weekday.displayOrder.forEach { weekday ->
                        DayCard(weekday = weekday, draft = draft, canWrite = canWrite, viewModel = viewModel)
                    }
                    if (canWrite) {
                        KlinaraButton(
                            title = "Kaydet",
                            onClick = viewModel::save,
                            enabled = draft.isDirty && draft.isValid,
                            isLoading = state.isSaving,
                        )
                    }
                }
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }
}

@Composable
private fun DayCard(
    weekday: Weekday,
    draft: WeekHoursDraft,
    canWrite: Boolean,
    viewModel: BranchHoursViewModel,
) {
    val day = draft.day(weekday)
    fun edit(transform: (WeekHoursDraft.Day) -> WeekHoursDraft.Day) = viewModel.update { it.update(weekday, transform) }

    KlinaraCard(title = weekday.turkishName) {
        KlinaraToggleRow(
            label = "Kapalı",
            isOn = day.isClosed,
            onToggle = { on -> edit { it.copy(isClosed = on) } },
            enabled = canWrite,
        )
        if (day.isClosed) return@KlinaraCard

        KlinaraTimeField(
            label = "Açılış",
            value = day.open.toLocalTime(),
            onValueChange = { time -> edit { it.copy(open = time.toClockTime()) } },
            enabled = canWrite,
        )
        KlinaraTimeField(
            label = "Kapanış",
            value = day.close.toLocalTime(),
            onValueChange = { time -> edit { it.copy(close = time.toClockTime()) } },
            enabled = canWrite,
        )
        KlinaraToggleRow(
            label = "Mola",
            isOn = day.hasBreak,
            onToggle = { on -> edit { it.copy(hasBreak = on) } },
            enabled = canWrite,
        )
        if (day.hasBreak) {
            KlinaraTimeField(
                label = "Mola başlangıcı",
                value = day.breakStart.toLocalTime(),
                onValueChange = { time -> edit { it.copy(breakStart = time.toClockTime()) } },
                enabled = canWrite,
            )
            KlinaraTimeField(
                label = "Mola bitişi",
                value = day.breakEnd.toLocalTime(),
                onValueChange = { time -> edit { it.copy(breakEnd = time.toClockTime()) } },
                enabled = canWrite,
            )
        }
        day.error?.let { FieldErrorText(it) }
        if (canWrite) {
            KlinaraButton(
                title = "Bu saatleri tüm açık günlere uygula",
                onClick = { viewModel.update { it.applyToOpenDays(weekday) } },
                kind = KlinaraButtonKind.Tertiary,
            )
        }
    }
}
