package com.klinara.android.features.customers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.services.crm.TimelineEntry
import com.klinara.android.services.crm.TimelineKind
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable

/**
 * Zaman çizelgesi — randevu, not, onam ve paket olayları tek akışta.
 *
 * **Dürüstlük dipnotu:** klinik notlar izinsiz kullanıcıya hiç gelmiyor. Bunu söylememek,
 * eksik bir geçmişi tam bir geçmiş gibi göstermek olurdu.
 */
@Composable
fun CustomerTimelineSection(
    state: CustomerRecordUiState,
    canReadMedical: Boolean,
    clock: BranchClock,
    onApplyFilter: (Set<TimelineKind>) -> Unit,
    onClearFilter: () -> Unit,
    onLoadMore: () -> Unit,
    onSelectNote: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors

    KlinaraCard(
        title = "Zaman çizelgesi",
        footnote =
            if (canReadMedical) null else "Klinik notlar yetkiniz olmadığı için listeye dâhil edilmedi.",
        modifier = modifier,
    ) {
        TimelineFilters(
            selected = state.kinds,
            onApplyFilter = onApplyFilter,
            onClearFilter = onClearFilter,
        )

        when (val timeline = state.timeline) {
            Loadable.Loading ->
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = colors.charcoalMuted)

            is Loadable.Failed -> ErrorBanner(message = timeline.message)

            is Loadable.Loaded ->
                if (timeline.value.isEmpty()) {
                    // "Bu filtreyle kayıt yok" ile "hiç kayıt yok" AYRI iki şey.
                    Text(
                        text =
                            if (state.isFiltered) {
                                "Bu filtreyle gösterilecek kayıt yok."
                            } else {
                                "Henüz kayıt yok."
                            },
                        style = KlinaraType.bodyM,
                        color = colors.charcoalMuted,
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
                        timeline.value.forEachIndexed { index, entry ->
                            if (index > 0) KlinaraDivider()
                            TimelineRow(entry = entry, clock = clock, onSelectNote = onSelectNote)
                        }
                    }

                    if (state.canLoadMore) {
                        KlinaraButton(
                            title = "Daha fazla",
                            onClick = onLoadMore,
                            kind = KlinaraButtonKind.Tertiary,
                            isLoading = state.isLoadingMore,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TimelineFilters(
    selected: Set<TimelineKind>,
    onApplyFilter: (Set<TimelineKind>) -> Unit,
    onClearFilter: () -> Unit,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        TimelineKind.selectable.forEach { kind ->
            SelectableChip(
                label = kind.turkishName,
                isSelected = kind in selected,
                onClick = {
                    onApplyFilter(if (kind in selected) selected - kind else selected + kind)
                },
            )
        }
        if (selected.isNotEmpty()) {
            SelectableChip(label = "Temizle", isSelected = false, onClick = onClearFilter)
        }
    }
}

@Composable
private fun TimelineRow(
    entry: TimelineEntry,
    clock: BranchClock,
    onSelectNote: (String) -> Unit,
) {
    val colors = KlinaraTheme.colors
    // Yalnız NOT satırları tıklanabilir: diğer türlerin açılacak bir düzenleyicisi yok
    // ve her satırı tıklanabilir göstermek, çoğunda hiçbir şey olmaması demekti.
    val isNote = entry.kind == TimelineKind.Note
    val interactionSource = remember { MutableInteractionSource() }

    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .let {
                    if (isNote) {
                        it.klinaraClickable(true, Role.Button, interactionSource) { onSelectNote(entry.id) }
                    } else {
                        it
                    }
                }.semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        KlinaraBadge(
            text = entry.kind.turkishName,
            // Bilinmeyen tür SESSİZCE geçmiyor: uyarı tonuyla çiziliyor ki eksik bir
            // geçmiş, tam bir geçmiş gibi görünmesin.
            tone = if (entry.kind == TimelineKind.Unknown) KlinaraBadgeTone.Warning else KlinaraBadgeTone.Neutral,
        )
        Text(text = entry.title, style = KlinaraType.bodyEmphasis, color = colors.charcoal)
        entry.subtitle?.let {
            Text(text = it, style = KlinaraType.bodyM, color = colors.charcoalMuted)
        }
        entry.occurredAt?.let {
            Text(text = clock.formatDateTime(it), style = KlinaraType.bodyM, color = colors.charcoalMuted)
        }
    }
}
