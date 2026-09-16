package com.klinara.android.features.scheduling

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.FieldErrorText
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDateField
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.designsystem.components.KlinaraSelectableRow
import com.klinara.android.designsystem.components.KlinaraStepperRow
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraTimeField
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.customers.SelectableChip
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.scheduling.ScheduleException
import com.klinara.android.services.scheduling.ScheduleRecurrence
import com.klinara.android.services.scheduling.Weekday

/**
 * Yeni istisna (A7.3) — iOS `ScheduleExceptionEditorView` paritesi. Yalnız oluşturma.
 *
 * Tarih ve saatler **şube diliminde** seçilir ve öyle gönderilir. Haftalık tekrarda gün,
 * sıklık ve bitiş tarihi zorunlu; tek seferlikte tekrar alanları gövdeye hiç girmez (sunucu
 * 400). Yalnız `schedule:write` ile ulaşılır.
 */
@Composable
fun ScheduleExceptionEditorScreen(
    session: AppSession,
    container: ServiceContainer,
    presetStaffProfileId: String?,
    onBack: () -> Unit,
    onSaved: (ScheduleException) -> Unit,
    modifier: Modifier = Modifier,
) {
    val branch = session.activeBranch
    if (branch == null) {
        KlinaraScreen(title = "Yeni istisna", modifier = modifier, onBack = onBack) {
            NoBranchState("İstisna eklemek için bir şube seçin.")
        }
        return
    }
    EditorContent(container, branch, presetStaffProfileId, onBack, onSaved, modifier)
}

@Suppress("LongParameterList")
@Composable
private fun EditorContent(
    container: ServiceContainer,
    branch: BranchSummary,
    presetStaffProfileId: String?,
    onBack: () -> Unit,
    onSaved: (ScheduleException) -> Unit,
    modifier: Modifier,
) {
    val viewModel: ScheduleExceptionEditorViewModel =
        viewModel(
            key = "schedule-exception-editor-${branch.id}-${presetStaffProfileId ?: "any"}",
            factory =
                ScheduleExceptionEditorViewModel.factory(container, branch.id, presetStaffProfileId, branch.timezone),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    // iOS gibi: yeni bir istisna formu her zaman "kirli" sayılır — çıkış onay ister.
    val back = rememberUnsavedChangesGuard(isDirty = state.saved == null, onLeave = onBack)

    LaunchedEffect(Unit) { viewModel.load() }
    LaunchedEffect(state.saved) { state.saved?.let(onSaved) }

    Box {
        KlinaraScreen(title = "Yeni istisna", modifier = modifier, onBack = back) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }
            if (viewModel.needsStaffPicker) StaffCard(state = state, viewModel = viewModel)
            RangeCard(state = state, timezone = branch.timezone, viewModel = viewModel)
            RecurrenceCard(state = state, viewModel = viewModel)
            KlinaraButton(
                title = "Oluştur",
                onClick = viewModel::save,
                enabled = state.draft.isValid,
                isLoading = state.isSaving,
            )
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }
}

@Composable
private fun StaffCard(
    state: ScheduleExceptionEditorUiState,
    viewModel: ScheduleExceptionEditorViewModel,
) {
    KlinaraCard(title = "Personel") {
        when (val staff = state.staff) {
            Loadable.Loading ->
                Text("Personel yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            is Loadable.Failed ->
                ErrorBanner(message = staff.message, onRetry = if (staff.isRetryable) viewModel::load else null)
            is Loadable.Loaded ->
                if (staff.value.isEmpty()) {
                    KlinaraRow(
                        label = "Bu şubede aktif personel yok",
                        detail = "Personeli şubeye Yönetim → Şube ve Personel'den atayın.",
                    )
                } else {
                    staff.value.forEachIndexed { index, profile ->
                        if (index > 0) KlinaraDivider()
                        KlinaraSelectableRow(
                            title = profile.userFullName,
                            detail = profile.title,
                            isSelected = state.draft.staffProfileId == profile.id,
                            onClick = { viewModel.update { it.copy(staffProfileId = profile.id) } },
                        )
                    }
                }
        }
    }
}

@Composable
private fun RangeCard(
    state: ScheduleExceptionEditorUiState,
    timezone: String,
    viewModel: ScheduleExceptionEditorViewModel,
) {
    val draft = state.draft
    KlinaraCard(title = "Aralık", footnote = "Saatler $timezone diliminde. Bitiş, başlangıçtan sonra olmalı.") {
        KlinaraDateField(
            label = "Başlangıç",
            value = draft.startDate,
            onValueChange = { date -> viewModel.update { it.withStart(date = date) } },
        )
        KlinaraTimeField(
            label = "Başlangıç saati",
            value = draft.startTime.toLocalTime(),
            onValueChange = { time -> viewModel.update { it.withStart(time = time.toClockTime()) } },
        )
        KlinaraDivider()
        KlinaraDateField(
            label = "Bitiş",
            value = draft.endDate,
            minDate = draft.startDate,
            onValueChange = { date -> viewModel.update { it.copy(endDate = date) } },
        )
        KlinaraTimeField(
            label = "Bitiş saati",
            value = draft.endTime.toLocalTime(),
            onValueChange = { time -> viewModel.update { it.copy(endTime = time.toClockTime()) } },
            error = draft.rangeError ?: state.fieldErrors["endsAt"],
        )
        KlinaraTextField(
            label = "Sebep",
            value = draft.reason,
            onValueChange = { value -> viewModel.update { it.copy(reason = value) } },
            placeholder = "Yıllık izin, resmî tatil…",
            error = state.fieldErrors["reason"],
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RecurrenceCard(
    state: ScheduleExceptionEditorUiState,
    viewModel: ScheduleExceptionEditorViewModel,
) {
    val draft = state.draft
    KlinaraCard(title = "Tekrar") {
        KlinaraSegmentedPicker(
            options = ScheduleRecurrence.selectable,
            selected = draft.recurrence,
            onSelect = { value -> viewModel.update { it.copy(recurrence = value) } },
            title = { it.turkishName },
            modifier = Modifier.fillMaxWidth(),
        )
        if (draft.recurrence != ScheduleRecurrence.Weekly) return@KlinaraCard

        Text("GÜNLER", style = KlinaraType.label, color = KlinaraTheme.colors.charcoalMuted)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            Weekday.displayOrder.forEach { weekday ->
                SelectableChip(
                    label = weekday.shortName,
                    isSelected = weekday.dow in draft.weekdays,
                    onClick = { viewModel.update { it.toggleWeekday(weekday.dow) } },
                )
            }
        }
        KlinaraStepperRow(
            label = "Sıklık",
            value = draft.intervalWeeks,
            onValueChange = { value -> viewModel.update { it.copy(intervalWeeks = value) } },
            range = ScheduleExceptionDraft.INTERVAL_RANGE,
            format = { if (it == 1) "Her hafta" else "$it haftada bir" },
        )
        KlinaraDateField(
            label = "Şu tarihe kadar",
            value = draft.untilDate,
            minDate = draft.endDate,
            onValueChange = { date -> viewModel.update { it.copy(untilDate = date) } },
        )
        FieldErrorText(draft.recurrenceError ?: state.fieldErrors["recurrenceUntil"])
    }
}
