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
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraTimeField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.scheduling.Weekday

/**
 * Personelin haftalık programı (A7.3) — iOS `StaffScheduleView` paritesi.
 *
 * Program SEÇİLİ ŞUBE için; iki şubede çalışan personelin ikinci programı şube menüsünden
 * açılır (kirliyken menü gizli). Hiç kaydı olmayan personelde açık bir uyarı var: sunucuda
 * kaydı olmayan gün "çalışmıyor" demek ve o personele randevu açılamıyor — ekrandaki
 * varsayılan saatler kaydedilene kadar yalnız bir öneri.
 */
@Composable
fun StaffScheduleScreen(
    session: AppSession,
    container: ServiceContainer,
    staffProfileId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val branch = session.activeBranch
    if (branch == null) {
        KlinaraScreen(title = "Haftalık program", modifier = modifier, onBack = onBack, trailing = trailing) {
            NoBranchState("Programı görüntülemek için bir şube seçin.")
        }
        return
    }
    StaffScheduleContent(session, container, staffProfileId, branch, onBack, modifier, trailing)
}

@Suppress("LongParameterList")
@Composable
private fun StaffScheduleContent(
    session: AppSession,
    container: ServiceContainer,
    staffProfileId: String,
    branch: BranchSummary,
    onBack: () -> Unit,
    modifier: Modifier,
    trailing: @Composable (RowScope.() -> Unit)?,
) {
    val viewModel: StaffScheduleViewModel =
        viewModel(
            key = "staff-schedule-$staffProfileId-${branch.id}",
            factory = StaffScheduleViewModel.factory(container, staffProfileId, branch.id),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canWrite = session.can(Permissions.SCHEDULE_WRITE)
    val isDirty = state.draft?.isDirty == true
    val back = rememberUnsavedChangesGuard(isDirty = isDirty, onLeave = onBack)

    LaunchedEffect(branch.id) { viewModel.load() }

    Box {
        KlinaraScreen(
            title = state.staffName ?: "Haftalık program",
            modifier = modifier,
            onBack = back,
            trailing = trailing.takeUnless { isDirty },
        ) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }
            Text(
                "${branch.name} için geçerli. Personel başka şubede de çalışıyorsa oranın programı ayrı tutulur.",
                style = KlinaraType.bodyM,
                color = KlinaraTheme.colors.charcoalMuted,
            )

            when (val loaded = state.loaded) {
                Loadable.Loading ->
                    Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
                is Loadable.Failed ->
                    ErrorBanner(message = loaded.message, onRetry = if (loaded.isRetryable) viewModel::load else null)
                is Loadable.Loaded -> {
                    val draft = state.draft ?: return@KlinaraScreen
                    if (state.hasNoRecord) {
                        Text(
                            "Bu şubede kayıtlı program yok — personele randevu açılamaz. Aşağıdaki saatler bir " +
                                "öneridir; kaydedince geçerli olur.",
                            style = KlinaraType.bodyM,
                            color = KlinaraTheme.colors.danger,
                        )
                    }
                    if (state.didSave) {
                        Text("Program kaydedildi.", style = KlinaraType.bodyM, color = KlinaraTheme.colors.sageDeep)
                    }
                    WeekCard(draft = draft, canWrite = canWrite, viewModel = viewModel)
                    if (canWrite) {
                        KlinaraButton(
                            title = "Kaydet",
                            onClick = viewModel::save,
                            enabled = state.canSave,
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
private fun WeekCard(
    draft: StaffWeekDraft,
    canWrite: Boolean,
    viewModel: StaffScheduleViewModel,
) {
    KlinaraCard {
        Weekday.displayOrder.forEachIndexed { index, weekday ->
            if (index > 0) KlinaraDivider()
            val day = draft.day(weekday)
            fun edit(transform: (StaffWeekDraft.Day) -> StaffWeekDraft.Day) =
                viewModel.update { it.update(weekday, transform) }

            KlinaraToggleRow(
                label = weekday.turkishName,
                detail = if (day.isWorking) "${day.start.displayValue} – ${day.end.displayValue}" else "İzinli",
                isOn = day.isWorking,
                onToggle = { on -> edit { it.copy(isWorking = on) } },
                enabled = canWrite,
            )
            if (day.isWorking) {
                KlinaraTimeField(
                    label = "Başlangıç",
                    value = day.start.toLocalTime(),
                    onValueChange = { time -> edit { it.copy(start = time.toClockTime()) } },
                    enabled = canWrite,
                )
                KlinaraTimeField(
                    label = "Bitiş",
                    value = day.end.toLocalTime(),
                    onValueChange = { time -> edit { it.copy(end = time.toClockTime()) } },
                    enabled = canWrite,
                )
                day.error?.let { FieldErrorText(it) }
            }
        }
    }
}
