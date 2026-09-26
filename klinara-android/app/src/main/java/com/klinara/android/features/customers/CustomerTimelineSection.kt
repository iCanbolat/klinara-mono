package com.klinara.android.features.customers

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.klinara.android.designsystem.components.KlinaraSkeletonSection
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.crm.TimelineEntry
import com.klinara.android.services.crm.TimelineKind
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.LedgerEntryType

/**
 * Zaman çizelgesi — randevu, not ve paket olayları tek akışta.
 *
 * Onam kayıtları kartta GÖSTERİLMİYOR: her randevu öncesi yenilenen KVKK onayı akışı
 * kalabalıklaştırıyordu ve personelin bu ekranda onamla yapacağı bir iş yok.
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
    onSelectAppointment: (String) -> Unit,
    onSelectPackage: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        // Başlık kartın DIŞINDA ve filtreden ÖNCE: çipler başlığın altında, kartın
        // üstünde duruyor ki "hangi bölümün filtresi" sorusu doğmasın.
        Text(
            KlinaraType.labelText("Zaman çizelgesi"),
            style = KlinaraType.label,
            color = colors.charcoalMuted,
            modifier = Modifier.padding(start = KlinaraMetrics.xs),
        )

        TimelineFilters(
            selected = state.kinds,
            onApplyFilter = onApplyFilter,
            onClearFilter = onClearFilter,
        )

        KlinaraCard(
            footnote =
                if (canReadMedical) null else "Klinik notlar yetkiniz olmadığı için listeye dâhil edilmedi.",
        ) {
            when (val timeline = state.timeline) {
                Loadable.Loading ->
                    KlinaraSkeletonSection()

                is Loadable.Failed -> ErrorBanner(message = timeline.message)

                is Loadable.Loaded -> {
                    val entries = timeline.value.filter { it.kind != TimelineKind.Consent }
                    if (entries.isEmpty()) {
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
                        entries.forEachIndexed { index, entry ->
                            if (index > 0) KlinaraDivider()
                            TimelineRow(
                                entry = entry,
                                clock = clock,
                                onSelectNote = onSelectNote,
                                onSelectAppointment = onSelectAppointment,
                                onSelectPackage = onSelectPackage,
                            )
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
}

/** Filtrede gösterilen türler — onam kartta hiç çizilmediği için filtrede de yok. */
private val filterKinds = TimelineKind.selectable.filter { it != TimelineKind.Consent }

/** Tek satır, yatay kaydırılan küçük çipler — iOS'taki filtre çubuğunun karşılığı. */
@Composable
private fun TimelineFilters(
    selected: Set<TimelineKind>,
    onApplyFilter: (Set<TimelineKind>) -> Unit,
    onClearFilter: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        filterKinds.forEach { kind ->
            TimelineChip(
                label = kind.turkishName,
                isSelected = kind in selected,
                onClick = {
                    // Çoklu seçim: "randevu VE not" meşru bir soru.
                    onApplyFilter(if (kind in selected) selected - kind else selected + kind)
                },
            )
        }
        if (selected.isNotEmpty()) {
            TimelineChip(label = "Temizle", isSelected = false, onClick = onClearFilter)
        }
    }
}

/**
 * Küçük kapsül çip.
 *
 * Tıklama alanı (48dp) GÖRSELİN dışında kalıyor: `klinaraClickable` zemin ve kenarlıktan
 * önce uygulanıyor, yoksa zemin 48dp'lik alana yayılıp çipi iri gösterirdi.
 */
@Composable
private fun TimelineChip(
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }

    Text(
        text = label,
        style = KlinaraType.bodyM.copy(fontSize = 13.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
        color = if (isSelected) colors.surfaceRaised else colors.charcoal,
        maxLines = 1,
        modifier =
            Modifier
                .semantics { selected = isSelected }
                .klinaraClickable(true, Role.Checkbox, interactionSource, onClick)
                .clip(CircleShape)
                .background(if (isSelected) colors.sageDeep else colors.surfaceRaised)
                .border(
                    width = KlinaraMetrics.borderWidth,
                    color = if (isSelected) colors.sageDeep else colors.border,
                    shape = CircleShape,
                ).padding(horizontal = 12.dp, vertical = 7.dp),
    )
}

@Composable
private fun TimelineRow(
    entry: TimelineEntry,
    clock: BranchClock,
    onSelectNote: (String) -> Unit,
    onSelectAppointment: (String) -> Unit,
    onSelectPackage: (String) -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val date = entry.occurredAt?.let(clock::formatDateTime)

    // Satırın açtığı ekran türe göre: randevu → randevu detayı, not → düzenleyici,
    // paket olayları → paket detayı. Açılacak bir şeyi olmayan satır tıklanabilir
    // GÖRÜNMÜYOR.
    val onClick: (() -> Unit)? =
        when (entry.kind) {
            TimelineKind.Appointment -> { { onSelectAppointment(entry.id) } }
            TimelineKind.Note -> { { onSelectNote(entry.id) } }
            TimelineKind.PackageSale -> { { onSelectPackage(entry.id) } }
            TimelineKind.PackageLedger -> entry.string("customerPackageId")?.let { { onSelectPackage(it) } }
            TimelineKind.Consent, TimelineKind.Unknown -> null
        }

    val title: String
    val detail: String?
    when (entry.kind) {
        TimelineKind.Appointment -> {
            title = entry.string("serviceName") ?: "Randevu"
            val startsAt = entry.instant("startsAt")?.let(clock::formatDateTime) ?: date
            detail = listOfNotNull(startsAt, entry.long("totalMinor")?.let { Money.format(it) }).joinToString(" · ")
        }
        TimelineKind.Note -> {
            title = entry.string("body") ?: "Not"
            detail = listOfNotNull(entry.title, date).joinToString(" · ")
        }
        TimelineKind.PackageSale -> {
            title = entry.title
            detail =
                listOfNotNull(
                    "Paket satışı",
                    entry.long("totalPriceMinor")?.let { Money.format(it, entry.string("currency") ?: "TRY") },
                    date,
                ).joinToString(" · ")
        }
        TimelineKind.PackageLedger -> {
            title = entry.string("entryType")?.let { LedgerEntryType.from(it).turkishName } ?: entry.title
            // `delta` işaretli geliyor; `+`/`-` AÇIKÇA yazılıyor ki hakkın düştüğü mü
            // eklendiği mi belirsiz kalmasın.
            val delta = entry.long("delta")?.let { if (it > 0) "+$it seans" else "$it seans" }
            detail = listOfNotNull(entry.string("serviceName"), delta, date).joinToString(" · ")
        }
        else -> {
            title = entry.title
            detail = listOfNotNull(entry.kind.turkishName.takeIf { entry.kind != TimelineKind.Unknown }, date)
                .joinToString(" · ")
                .ifEmpty { null }
        }
    }

    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .let {
                    if (onClick != null) it.klinaraClickable(true, Role.Button, interactionSource, onClick) else it
                }.semantics(mergeDescendants = true) {}
                .padding(vertical = KlinaraMetrics.xs),
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = title,
                style = KlinaraType.bodyM,
                color = colors.charcoal,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            detail?.let {
                Text(text = it, style = KlinaraType.bodyM.copy(fontSize = 13.sp), color = colors.charcoalMuted)
            }
        }

        when (entry.kind) {
            TimelineKind.Appointment ->
                entry.string("status")?.let { AppointmentStatus.from(it) }?.let { status ->
                    KlinaraBadge(text = status.turkishName, tone = status.badgeTone)
                }
            // Bilinmeyen tür SESSİZCE geçmiyor: uyarı tonuyla çiziliyor ki eksik bir
            // geçmiş, tam bir geçmiş gibi görünmesin.
            TimelineKind.Unknown -> KlinaraBadge(text = "Diğer", tone = KlinaraBadgeTone.Warning)
            else -> Unit
        }
    }
}
