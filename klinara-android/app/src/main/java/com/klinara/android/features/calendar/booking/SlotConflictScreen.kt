package com.klinara.android.features.calendar.booking

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.services.booking.AvailabilitySlot
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.ApiError

/**
 * Çakışma sayfası.
 *
 * **409 `SLOT_CONFLICT` bir hata değil, bir bilgidir.** Sunucu EXCLUDE kısıtıyla zaten
 * yazdırmadı; kullanıcının ihtiyacı "bu saat dolu" cümlesi değil, **alternatif
 * saatler**. Bu yüzden burada bir hata afişi değil, seçilebilir öneriler var.
 *
 * Öneriye dokunmak taslağı **doldurur, kaydetmez**: son sözü kullanıcı söyler.
 */
@Composable
fun SlotConflictScreen(
    error: ApiError,
    clock: BranchClock,
    staffName: (String) -> String,
    onPick: (AvailabilitySlot) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors

    KlinaraScreen(title = "Seçilen saat dolu", onBack = onBack, modifier = modifier) {
        KlinaraCard(
            title = "Dolu olan",
            // Tamponlar yüzünden çakışan aralık, kullanıcının gördüğü saatten geniştir;
            // söylemezsek "ama 15:00 boştu" itirazının cevabı olmaz.
            footnote = "Bu aralıklar hazırlık payını da içerir.",
        ) {
            if (error.slotConflicts.isEmpty()) {
                Text(
                    "Çakışan kayıt bilgisi gelmedi.",
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                )
            }
            error.slotConflicts.forEachIndexed { index, conflict ->
                if (index > 0) KlinaraDivider()
                val from = conflict.from
                val to = conflict.to
                Text(
                    conflict.resourceId?.let(staffName) ?: "Kaynak",
                    style = KlinaraType.bodyEmphasis,
                    color = colors.charcoal,
                )
                if (from != null && to != null) {
                    Text(
                        clock.formatRange(from, to),
                        style = KlinaraType.bodyM,
                        color = colors.charcoalMuted,
                    )
                }
            }
        }

        if (error.slotSuggestions.isEmpty()) {
            KlinaraCard {
                Text(
                    "Yakın bir alternatif bulunamadı. Başka bir gün ya da personel deneyin.",
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                )
            }
        } else {
            KlinaraCard(title = "Önerilen saatler") {
                error.slotSuggestions.forEachIndexed { index, suggestion ->
                    if (index > 0) KlinaraDivider()
                    val label =
                        buildString {
                            append(clock.formatDate(suggestion.startsAt))
                            append(", ${clock.formatRange(suggestion.startsAt, suggestion.endsAt)}")
                            val names = suggestion.staffProfileIds.map(staffName)
                            if (names.isNotEmpty()) append(", ${names.joinToString(", ")}")
                        }
                    val interaction = remember(suggestion.startsAt) { MutableInteractionSource() }

                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .klinaraClickable(
                                    enabled = true,
                                    role = Role.Button,
                                    interactionSource = interaction,
                                    onClick = {
                                        onPick(
                                            AvailabilitySlot(
                                                startsAt = suggestion.startsAt,
                                                endsAt = suggestion.endsAt,
                                                staffProfileIds = suggestion.staffProfileIds,
                                            ),
                                        )
                                    },
                                ).clearAndSetSemantics {
                                    contentDescription = label
                                    role = Role.Button
                                }.padding(vertical = KlinaraMetrics.xs),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
                    ) {
                        androidx.compose.foundation.layout.Column(modifier = Modifier.weight(1f)) {
                            Text(
                                clock.formatRange(suggestion.startsAt, suggestion.endsAt),
                                style = KlinaraType.bodyEmphasis,
                                color = colors.charcoal,
                            )
                            Text(
                                suggestion.staffProfileIds.joinToString(", ", transform = staffName),
                                style = KlinaraType.bodyM,
                                color = colors.charcoalMuted,
                            )
                        }
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = null,
                            tint = colors.charcoalMuted,
                        )
                    }
                }
            }
        }
    }
}
