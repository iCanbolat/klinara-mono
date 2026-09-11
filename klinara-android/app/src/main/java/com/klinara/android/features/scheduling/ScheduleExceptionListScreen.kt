package com.klinara.android.features.scheduling

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.scheduling.ScheduleException
import com.klinara.android.services.scheduling.ScheduleRecurrence
import com.klinara.android.services.scheduling.Weekday

/**
 * İzin ve istisnalar (A7.3) — iOS `ScheduleExceptionListView` paritesi.
 *
 * Yönetim'den şube geneli, personel detayından o personele daraltılmış açılır. Satırlar
 * düzenlenmez (sunucuda PATCH yok); "Kaldır" yumuşak siler ve personel o aralıkta yeniden
 * müsait olur. Kaldırma hatası **yutulmaz**.
 */
@Composable
fun ScheduleExceptionListScreen(
    session: AppSession,
    container: ServiceContainer,
    staffProfileId: String?,
    onBack: () -> Unit,
    onCreate: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val branch = session.activeBranch
    if (branch == null) {
        KlinaraScreen(title = "İzin ve istisnalar", modifier = modifier, onBack = onBack, trailing = trailing) {
            NoBranchState("İstisnaları görüntülemek için bir şube seçin.")
        }
        return
    }
    ExceptionListContent(session, container, branch, staffProfileId, onBack, onCreate, modifier, trailing)
}

@Suppress("LongParameterList")
@Composable
private fun ExceptionListContent(
    session: AppSession,
    container: ServiceContainer,
    branch: BranchSummary,
    staffProfileId: String?,
    onBack: () -> Unit,
    onCreate: () -> Unit,
    modifier: Modifier,
    trailing: @Composable (RowScope.() -> Unit)?,
) {
    val viewModel: ScheduleExceptionListViewModel =
        viewModel(
            key = "schedule-exceptions-${branch.id}-${staffProfileId ?: "all"}",
            factory = ScheduleExceptionListViewModel.factory(container, branch.id, staffProfileId, branch.timezone),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canWrite = session.can(Permissions.SCHEDULE_WRITE)
    val clock = remember(branch.timezone) { BranchClock(branch.timezone) }

    // Editörden dönüşte de koşar: yeni istisna listede görünsün.
    LaunchedEffect(Unit) { viewModel.load() }

    Box {
        KlinaraScreen(title = "İzin ve istisnalar", modifier = modifier, onBack = onBack, trailing = trailing) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }
            KlinaraSegmentedPicker(
                options = ExceptionRange.entries,
                selected = state.range,
                onSelect = viewModel::setRange,
                title = { it.title },
                modifier = Modifier.fillMaxWidth(),
            )

            when (val rows = state.rows) {
                Loadable.Loading ->
                    Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
                is Loadable.Failed ->
                    ErrorBanner(message = rows.message, onRetry = if (rows.isRetryable) viewModel::load else null)
                is Loadable.Loaded ->
                    if (rows.value.isEmpty()) {
                        EmptyStateView(
                            title = "İstisna yok",
                            message = "Seçilen aralıkta izin, tatil veya özel açılış kaydı bulunmuyor.",
                            icon = Icons.Filled.DateRange,
                        )
                    } else {
                        KlinaraCard(footnote = "Kayıtlar ${branch.timezone} saat diliminde gösterilir.") {
                            rows.value.forEachIndexed { index, exception ->
                                if (index > 0) KlinaraDivider()
                                ExceptionRow(
                                    exception = exception,
                                    staffName = state.staffNames[exception.staffProfileId] ?: "Personel",
                                    clock = clock,
                                    canWrite = canWrite,
                                    onDelete = { viewModel.askDelete(exception) },
                                )
                            }
                        }
                    }
            }

            if (canWrite) {
                KlinaraButton(
                    title = "Yeni istisna",
                    onClick = onCreate,
                    kind = KlinaraButtonKind.Secondary,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }

    state.pendingDelete?.let {
        AlertDialog(
            onDismissRequest = viewModel::cancelDelete,
            title = { Text("İstisna kaldırılsın mı?", style = KlinaraType.titleM) },
            text = {
                Text(
                    "Kayıt silinmez, pasife alınır. Personel bu aralıkta yeniden müsait olur.",
                    style = KlinaraType.bodyM,
                )
            },
            confirmButton = { TextButton(onClick = viewModel::confirmDelete) { Text("Kaldır") } },
            dismissButton = { TextButton(onClick = viewModel::cancelDelete) { Text("Vazgeç") } },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ExceptionRow(
    exception: ScheduleException,
    staffName: String,
    clock: BranchClock,
    canWrite: Boolean,
    onDelete: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
        KlinaraRow(label = staffName, detail = clock.formatSpan(exception.startsAt, exception.endsAt))
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            recurrenceLabel(exception)?.let { KlinaraBadge(it) }
            exception.recurrenceUntil
                ?.takeIf { exception.recurrenceType == ScheduleRecurrence.Weekly }
                ?.let { KlinaraBadge("${clock.formatDate(it)} tarihine kadar", tone = KlinaraBadgeTone.Muted) }
            exception.reason?.takeIf { it.isNotBlank() }?.let { KlinaraBadge(it, tone = KlinaraBadgeTone.Muted) }
        }
        if (canWrite) {
            KlinaraButton(title = "Kaldır", onClick = onDelete, kind = KlinaraButtonKind.Tertiary)
        }
    }
}

/** "Pzt, Per · 2 haftada bir" — tek seferlikte `null`. */
internal fun recurrenceLabel(exception: ScheduleException): String? {
    if (exception.recurrenceType == ScheduleRecurrence.None) return null
    if (exception.recurrenceType == ScheduleRecurrence.Unknown) return ScheduleRecurrence.Unknown.turkishName
    val days =
        Weekday.displayOrder
            .filter { it.dow in exception.recurrenceWeekdays }
            .joinToString(", ") { it.shortName }
    val weeks = exception.recurrenceIntervalWeeks
    val every = if (weeks <= 1) "Her hafta" else "$weeks haftada bir"
    return listOf(days, every).filter { it.isNotEmpty() }.joinToString(" · ")
}
