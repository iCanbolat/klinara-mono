package com.klinara.android.features.customers

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
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
import com.klinara.android.services.crm.CustomerNote
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable

/**
 * Notlar bölümü.
 *
 * **Klinik not kapısı bir izin kapısı değil, bir DÜRÜSTLÜK kapısıdır.**
 * `customer.medical:read` olmayan kullanıcıya sunucu `treatment` ve `internal` notları
 * sorgudan **hiç döndürmüyor** ve yanıtta "gizlendi" bayrağı yok. Kısalmış bir liste
 * göstermek, resepsiyona *"bu müşterinin tedavi notu yok"* demektir — kliniğin en
 * hassas verisi hakkında yanlış bilgi.
 *
 * Bu yüzden izinsiz kullanıcıya **açık bir satır** yazılıyor: "göremiyorum" ile "yok"
 * arasındaki fark söyleniyor.
 */
@Composable
fun CustomerNotesSection(
    notes: Loadable<List<CustomerNote>>,
    canReadMedical: Boolean,
    canWrite: Boolean,
    clock: BranchClock,
    onSelectNote: (String) -> Unit,
    onCreateNote: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors

    KlinaraCard(
        title = "Notlar",
        footnote =
            if (canReadMedical) {
                null
            } else {
                "Klinik notları (tedavi, iç not) görme yetkiniz yok; bu listede yalnız " +
                    "genel notlar var. Müşterinin klinik notu OLABİLİR."
            },
        modifier = modifier,
    ) {
        when (notes) {
            Loadable.Loading ->
                KlinaraSkeletonSection()

            is Loadable.Failed -> ErrorBanner(message = notes.message)

            is Loadable.Loaded ->
                if (notes.value.isEmpty()) {
                    Text(
                        text =
                            if (canReadMedical) {
                                "Henüz not yok."
                            } else {
                                "Görebildiğiniz bir not yok."
                            },
                        style = KlinaraType.bodyM,
                        color = colors.charcoalMuted,
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
                        notes.value.forEachIndexed { index, note ->
                            if (index > 0) KlinaraDivider()
                            NoteRow(note = note, clock = clock, onClick = { onSelectNote(note.id) })
                        }
                    }
                }
        }

        onCreateNote?.takeIf { canWrite }?.let { onCreate ->
            KlinaraButton(
                title = "Not ekle",
                onClick = onCreate,
                kind = KlinaraButtonKind.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun NoteRow(
    note: CustomerNote,
    clock: BranchClock,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }

    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .klinaraClickable(true, Role.Button, interactionSource, onClick)
                .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        KlinaraBadge(
            text = note.kind.turkishName,
            tone = if (note.kind.isClinical) KlinaraBadgeTone.Warning else KlinaraBadgeTone.Neutral,
        )
        Text(
            text = note.body,
            style = KlinaraType.bodyM,
            color = colors.charcoal,
            maxLines = NOTE_PREVIEW_LINES,
            overflow = TextOverflow.Ellipsis,
        )
        note.updatedAt?.let {
            Text(
                // Düzenlenmiş notta sürümü söylemek, geçmişin var olduğunu haber verir.
                text =
                    if (note.wasEdited) {
                        "${clock.formatDateTime(it)} · sürüm ${note.version}"
                    } else {
                        clock.formatDateTime(it)
                    },
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
            )
        }
    }
}

private const val NOTE_PREVIEW_LINES = 3
