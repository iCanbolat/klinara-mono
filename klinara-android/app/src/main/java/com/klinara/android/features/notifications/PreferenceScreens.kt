package com.klinara.android.features.notifications

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.designsystem.components.KlinaraTimeField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.features.customers.SelectableChip
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.NotificationKind
import com.klinara.android.services.notifications.NotificationPreference
import java.time.LocalTime

/**
 * Bildirim tercihleri (A8.2) — iOS `NotificationPreferenceListView` paritesi.
 *
 * Kiracı varsayılanı ve şubeye özel satırlar AYRI kartlarda: tek listede karışmaları, kullanıcının
 * bir şubeye yazdığını tüm klinik için yaptığını sanmasıyla biterdi.
 */
@Composable
fun NotificationPreferenceListScreen(
    preferences: Loadable<List<NotificationPreference>>,
    branch: BranchSummary?,
    onOpen: (String) -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (androidx.compose.foundation.layout.RowScope.() -> Unit)? = null,
) {
    KlinaraScreen(title = "Bildirim tercihleri", modifier = modifier, onBack = onBack, trailing = trailing) {
        when (preferences) {
            Loadable.Loading ->
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            is Loadable.Failed ->
                ErrorBanner(message = preferences.message, onRetry = if (preferences.isRetryable) onRetry else null)
            is Loadable.Loaded -> {
                val tenant = preferences.value.filter { it.branchId == null }
                val branchRows = branch?.let { b -> preferences.value.filter { it.branchId == b.id } }.orEmpty()
                if (tenant.isEmpty() && branchRows.isEmpty()) {
                    EmptyStateView(
                        title = "Tercih yok",
                        message = "Sunucu hiçbir olay için tercih döndürmedi.",
                        icon = Icons.Filled.Notifications,
                    )
                } else {
                    if (branchRows.isNotEmpty()) {
                        KlinaraCard(
                            title = "${branch?.name ?: "Şube"} için özel",
                            footnote = "Bu satırlar kiracı varsayılanını yalnız bu şubede ezer.",
                        ) { PreferenceRows(branchRows, onOpen) }
                    }
                    KlinaraCard(
                        title = "Kiracı varsayılanı",
                        footnote = "Şubeye özel bir satır yoksa bu ayarlar geçerlidir.",
                    ) { PreferenceRows(tenant, onOpen) }
                }
            }
        }
    }
}

@Composable
private fun PreferenceRows(
    rows: List<NotificationPreference>,
    onOpen: (String) -> Unit,
) {
    rows.forEachIndexed { index, preference ->
        if (index > 0) KlinaraDivider()
        PreferenceRow(preference, onClick = { onOpen(preference.rowId) })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PreferenceRow(
    preference: NotificationPreference,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember { MutableInteractionSource() }
    Column(
        modifier = Modifier.fillMaxWidth().klinaraClickable(true, Role.Button, interaction, onClick),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            Text(preference.event.turkishName, style = KlinaraType.bodyEmphasis, color = colors.charcoal)
            if (preference.kind == NotificationKind.Marketing) {
                KlinaraBadge("Pazarlama", tone = KlinaraBadgeTone.Warning)
            }
            if (preference.isDefault) KlinaraBadge("Varsayılan", tone = KlinaraBadgeTone.Muted)
        }
        // Boş kanal listesi "olay kapalı" — bunu bir tireyle geçmek kapalıyı açık sandırırdı.
        Text(
            if (preference.isEnabled) preference.channels.joinToString(" → ") { it.turkishName } else "Kapalı",
            style = KlinaraType.bodyM,
            color = if (preference.isEnabled) colors.charcoalMuted else colors.danger,
        )
        Text(
            preference.quietHoursLabel?.let { "Sessiz saat: $it" } ?: "Sessiz saat yok",
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
        )
    }
}

/**
 * Tercih editörü (A8.2) — iOS `NotificationPreferenceEditorView` paritesi.
 *
 * Kanal listesi numaralı ve taşınabilir (öncelik sırası); sessiz saat anahtarı kapalıyken
 * eşit uçlar gider ([PreferenceDraft]). Kapsam seçicisi yalnız bir şube seçiliyse çizilir.
 */
@OptIn(ExperimentalLayoutApi::class)
@Suppress("LongParameterList")
@Composable
fun NotificationPreferenceEditorScreen(
    state: PreferenceEditorUiState,
    preference: NotificationPreference,
    branch: BranchSummary?,
    canWrite: Boolean,
    onUpdate: ((PreferenceDraft) -> PreferenceDraft) -> Unit,
    onSave: () -> Unit,
    onDismissError: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val draft = state.draft
    Box {
        KlinaraScreen(title = preference.event.turkishName, modifier = modifier, onBack = onBack) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = onDismissError) }

            KlinaraCard(
                title = "Kapsam",
                footnote = "Şubeye özel bir satır, kiracı varsayılanını yalnız o şubede ezer.",
            ) {
                KlinaraRow(label = "Olay", value = preference.event.turkishName, detail = preference.event.explanation)
                KlinaraDivider()
                KlinaraRow(label = "Tür", value = preference.kind.turkishName, detail = preference.kind.explanation)
                if (branch != null && canWrite) {
                    KlinaraDivider()
                    KlinaraSegmentedPicker(
                        options = listOf(false, true),
                        selected = draft.isBranchScope,
                        onSelect = { branchScope -> onUpdate { it.copy(isBranchScope = branchScope) } },
                        title = { if (it) branch.name else "Tüm klinik" },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            ChannelCard(draft, canWrite, onUpdate)
            QuietHoursCard(draft, canWrite, onUpdate)

            if (canWrite) {
                KlinaraButton(
                    title = "Kaydet",
                    onClick = onSave,
                    enabled = draft.isValid && draft.isDirty,
                    isLoading = state.isSaving,
                )
            }
        }
        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChannelCard(
    draft: PreferenceDraft,
    canWrite: Boolean,
    onUpdate: ((PreferenceDraft) -> PreferenceDraft) -> Unit,
) {
    val colors = KlinaraTheme.colors
    KlinaraCard(
        title = "Kanal önceliği",
        footnote =
            "Kanallar sırayla denenir; ilk başarılı gönderimde durulur. Liste boşsa bu olay için mesaj üretilmez.",
    ) {
        if (draft.channels.isEmpty()) {
            Text("Bu olay kapalı.", style = KlinaraType.bodyM, color = colors.danger)
        } else {
            draft.channels.forEachIndexed { index, channel ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${index + 1}.", style = KlinaraType.bodyM, color = colors.charcoalMuted)
                    Text(
                        channel.turkishName,
                        style = KlinaraType.bodyM,
                        color = colors.charcoal,
                        modifier = Modifier.weight(1f).padding(start = KlinaraMetrics.sm),
                    )
                    if (!channel.isDeliverable) KlinaraBadge("Kurulu değil", tone = KlinaraBadgeTone.Muted)
                    if (canWrite) {
                        IconButton(onClick = { onUpdate { it.movingUp(channel) } }, enabled = index > 0) {
                            Icon(
                                Icons.Filled.KeyboardArrowUp,
                                contentDescription = "${channel.turkishName} kanalını yukarı taşı",
                            )
                        }
                        IconButton(onClick = { onUpdate { it.removing(channel) } }) {
                            Icon(Icons.Filled.Close, contentDescription = "${channel.turkishName} kanalını kaldır")
                        }
                    }
                }
            }
        }
        if (canWrite && draft.availableChannels.isNotEmpty()) {
            KlinaraDivider()
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
                verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            ) {
                draft.availableChannels.forEach { channel ->
                    SelectableChip(
                        label =
                            if (channel.isDeliverable) channel.turkishName else "${channel.turkishName} · kurulu değil",
                        isSelected = false,
                        onClick = { onUpdate { it.adding(channel) } },
                    )
                }
            }
        }
    }
}

@Composable
private fun QuietHoursCard(
    draft: PreferenceDraft,
    canWrite: Boolean,
    onUpdate: ((PreferenceDraft) -> PreferenceDraft) -> Unit,
) {
    val colors = KlinaraTheme.colors
    KlinaraCard(
        title = "Sessiz saatler",
        footnote =
            "Bu aralıkta üretilen mesaj gönderilmez, pencere kapanınca gönderilir. Saatler şubenin saat " +
                "diliminde yorumlanır ve pencere gece yarısını aşabilir.",
    ) {
        KlinaraToggleRow(
            label = "Sessiz saat uygula",
            isOn = draft.quietHoursEnabled,
            onToggle = { on -> onUpdate { it.copy(quietHoursEnabled = on) } },
            enabled = canWrite,
        )
        if (draft.quietHoursEnabled) {
            KlinaraDivider()
            KlinaraTimeField(
                label = "Başlangıç",
                value = draft.quietStart.toLocalTime(),
                onValueChange = { time -> onUpdate { it.copy(quietStart = time.toClockTime()) } },
                enabled = canWrite,
            )
            KlinaraTimeField(
                label = "Bitiş",
                value = draft.quietEnd.toLocalTime(),
                onValueChange = { time -> onUpdate { it.copy(quietEnd = time.toClockTime()) } },
                enabled = canWrite,
                error = "Başlangıç ve bitiş aynı olamaz.".takeIf { !draft.isValid },
            )
            if (draft.crossesMidnight) {
                // Bir hata değil: kullanıcı bilmezse "bitiş başlangıçtan küçük" diye kendini düzeltmeye çalışırdı.
                Text(
                    "Pencere gece yarısını aşıyor: ${draft.quietStart.displayValue}'dan ertesi gün " +
                        "${draft.quietEnd.displayValue}'a kadar.",
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                )
            }
        } else {
            Text(
                "Mesajlar günün her saatinde gönderilir.",
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
            )
        }
    }
}

private fun ClockTime.toLocalTime(): LocalTime = LocalTime.of(hour, minute)

private fun LocalTime.toClockTime(): ClockTime = ClockTime(hour, minute)
