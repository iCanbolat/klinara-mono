package com.klinara.android.features.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraStepperRow
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.BranchReminderSettings

/**
 * Şube hatırlatma ayarları (A8.2) — iOS `ReminderSettingsView` paritesi.
 *
 * Ekranın incelikli yeri **override ayrımı**: `GET` çözülmüş ayarı döndürüyor; şubenin kendi
 * listesi yoksa kiracı varsayılanı geliyor. Rozet, açıklama ve "Kiracı varsayılanına dön" bunu
 * gösteriyor — yoksa kullanıcı bir şubede yaptığını hepsinde yaptığını sanır.
 */
@Suppress("LongParameterList")
@Composable
fun ReminderSettingsScreen(
    state: ReminderSettingsUiState,
    branch: BranchSummary,
    canWrite: Boolean,
    actions: ReminderSettingsActions,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    Box {
        KlinaraScreen(title = "Hatırlatma ayarları", modifier = modifier, onBack = onBack, trailing = trailing) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = actions.onDismissError) }
            when (val settings = state.settings) {
                Loadable.Loading ->
                    Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
                is Loadable.Failed ->
                    ErrorBanner(
                        message = settings.message,
                        onRetry = if (settings.isRetryable) actions.onRetry else null,
                    )
                is Loadable.Loaded -> {
                    val draft = state.draft ?: return@KlinaraScreen
                    ScopeCard(settings.value, branch, canWrite, actions.onAskReset)
                    HoursCard(state, draft, canWrite, actions)
                    FollowupCard(draft, canWrite, actions.onUpdate)
                    if (canWrite) {
                        KlinaraButton(
                            title = "Kaydet",
                            onClick = actions.onSave,
                            enabled = draft.isDirty && draft.isValid,
                            isLoading = state.isSaving,
                        )
                    }
                }
            }
        }
        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }

    if (state.confirmReset) {
        AlertDialog(
            onDismissRequest = actions.onCancelReset,
            title = { Text("Kiracı varsayılanına dönülsün mü?", style = KlinaraType.titleM) },
            text = {
                Text(
                    "${branch.name} şubesinin kendi hatırlatma saatleri silinir ve kiracı genelindeki saatler " +
                        "geçerli olur. Hatırlatmalar KAPANMAZ.",
                    style = KlinaraType.bodyM,
                )
            },
            confirmButton = { TextButton(onClick = actions.onConfirmReset) { Text("Varsayılana dön") } },
            dismissButton = { TextButton(onClick = actions.onCancelReset) { Text("Vazgeç") } },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        )
    }
}

/** Ekranın geri çağrıları tek taşıyıcıda — sekiz ayrı lambda parametresi okunmaz olurdu. */
data class ReminderSettingsActions(
    val onRetry: () -> Unit,
    val onUpdate: ((ReminderDraft) -> ReminderDraft) -> Unit,
    val onNewHourText: (String) -> Unit,
    val onAddHour: () -> Unit,
    val onSave: () -> Unit,
    val onAskReset: () -> Unit,
    val onConfirmReset: () -> Unit,
    val onCancelReset: () -> Unit,
    val onDismissError: () -> Unit,
)

@Composable
private fun ScopeCard(
    settings: BranchReminderSettings,
    branch: BranchSummary,
    canWrite: Boolean,
    onAskReset: () -> Unit,
) {
    KlinaraCard(title = "Kapsam") {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                branch.name,
                style = KlinaraType.bodyEmphasis,
                color = KlinaraTheme.colors.charcoal,
                modifier = Modifier.weight(1f),
            )
            KlinaraBadge(
                if (settings.isBranchOverride) "Şubeye özel" else "Kiracı varsayılanı",
                tone = if (settings.isBranchOverride) KlinaraBadgeTone.Positive else KlinaraBadgeTone.Muted,
            )
        }
        Text(
            if (settings.isBranchOverride) {
                "Bu şube kendi hatırlatma saatlerini kullanıyor. Diğer şubeler etkilenmez."
            } else {
                "Bu şube kiracı varsayılanını kullanıyor. Buradan kaydettiğiniz saatler yalnız bu şubeye yazılır."
            },
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.charcoalMuted,
        )
        if (canWrite && settings.isBranchOverride) {
            KlinaraButton(title = "Kiracı varsayılanına dön", onClick = onAskReset, kind = KlinaraButtonKind.Secondary)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HoursCard(
    state: ReminderSettingsUiState,
    draft: ReminderDraft,
    canWrite: Boolean,
    actions: ReminderSettingsActions,
) {
    val colors = KlinaraTheme.colors
    KlinaraCard(
        title = "Hatırlatma saatleri",
        footnote = "En çok 5 hatırlatma; her biri randevudan 1–720 saat önce. Varsayılan 24 ve 2 saat önce.",
    ) {
        if (draft.hours.isEmpty()) {
            // Boş liste gönderilemez: sunucu onu "override'ı kaldır" okuyor, "hatırlatma yok" değil.
            Text(
                "En az bir hatırlatma saati gerekir. Hatırlatmayı tamamen kapatmak için Bildirim " +
                    "tercihlerinde \"Randevu hatırlatması\"nın kanallarını boşaltın.",
                style = KlinaraType.bodyM,
                color = colors.danger,
            )
        } else {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
                verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            ) {
                draft.sortedHours.forEach { hour ->
                    HourChip(hour, canWrite, onRemove = { actions.onUpdate { it.removing(hour) } })
                }
            }
        }
        if (canWrite) {
            KlinaraTextField(
                label = "Saat ekle",
                value = state.newHourText,
                onValueChange = actions.onNewHourText,
                placeholder = "örn. 48",
                keyboardType = KeyboardType.Number,
                imeAction = ImeAction.Done,
                onSubmit = actions.onAddHour,
            )
            KlinaraButton(
                title = "Ekle",
                onClick = actions.onAddHour,
                kind = KlinaraButtonKind.Secondary,
                enabled = draft.canAdd(state.newHour),
            )
            if (draft.isAtCapacity) {
                Text("En çok 5 hatırlatma tanımlanabilir.", style = KlinaraType.bodyM, color = colors.charcoalMuted)
            }
        }
    }
}

@Composable
private fun HourChip(
    hour: Int,
    canWrite: Boolean,
    onRemove: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    Row(
        modifier =
            Modifier
                .background(colors.sageSoft, RoundedCornerShape(CHIP_RADIUS))
                .padding(start = KlinaraMetrics.md)
                .padding(vertical = if (canWrite) 0.dp else KlinaraMetrics.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("$hour saat önce", style = KlinaraType.bodyM, color = colors.charcoal)
        if (canWrite) {
            IconButton(onClick = onRemove) {
                Icon(Icons.Filled.Close, contentDescription = "$hour saat önceki hatırlatmayı kaldır")
            }
        } else {
            Box(Modifier.padding(end = KlinaraMetrics.md))
        }
    }
}

@Composable
private fun FollowupCard(
    draft: ReminderDraft,
    canWrite: Boolean,
    onUpdate: ((ReminderDraft) -> ReminderDraft) -> Unit,
) {
    KlinaraCard(
        title = "Gelmedi takibi",
        footnote = "Randevu \"gelmedi\" işaretlendikten sonra müşteriye tek bir takip mesajı gider.",
    ) {
        KlinaraToggleRow(
            label = "Takip mesajı gönder",
            isOn = draft.followupEnabled,
            onToggle = { on -> onUpdate { it.copy(followupEnabled = on) } },
            enabled = canWrite,
        )
        if (draft.followupEnabled) {
            KlinaraDivider()
            KlinaraStepperRow(
                label = "Gecikme",
                value = draft.followupDelayHours,
                onValueChange = { value -> onUpdate { it.copy(followupDelayHours = value) } },
                range = BranchReminderSettings.FOLLOWUP_DELAY_RANGE,
                detail = "Randevu bitiminden ne kadar sonra gönderilsin",
                enabled = canWrite,
                format = { "$it saat" },
            )
        }
    }
}

private val CHIP_RADIUS = 18.dp
