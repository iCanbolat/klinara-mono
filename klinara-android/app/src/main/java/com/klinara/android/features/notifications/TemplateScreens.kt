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
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
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
import com.klinara.android.designsystem.components.KlinaraTextEditor
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.features.customers.SelectableChip
import com.klinara.android.services.networking.Loadable

/**
 * Bildirim şablonları (A8.2) — iOS `NotificationTemplateListView` paritesi.
 *
 * Olaya göre gruplu; "ekle" düğmesi yok — sunucu etkin görünümü döndürüyor, var olan
 * düzenlenir. Satırlar izinsiz kullanıcıda da açılır (editör salt okunur); iOS'ta tercih
 * listesinin satırları ise ölüydü — burada iki liste aynı davranıyor.
 */
@Composable
fun NotificationTemplateListScreen(
    templates: Loadable<List<TemplateGroup>>,
    canWrite: Boolean,
    onOpen: (String) -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    KlinaraScreen(title = "Bildirim şablonları", modifier = modifier, onBack = onBack) {
        if (!canWrite) {
            Text(
                "Şablonları görüntüleyebilirsiniz; değiştirmek için bildirim yönetimi izni gerekir.",
                style = KlinaraType.bodyM,
                color = KlinaraTheme.colors.charcoalMuted,
            )
        }
        when (templates) {
            Loadable.Loading ->
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            is Loadable.Failed ->
                ErrorBanner(message = templates.message, onRetry = if (templates.isRetryable) onRetry else null)
            is Loadable.Loaded ->
                if (templates.value.isEmpty()) {
                    EmptyStateView(
                        title = "Şablon yok",
                        message = "Sunucu hiçbir olay için şablon döndürmedi.",
                        icon = Icons.Filled.Edit,
                    )
                } else {
                    templates.value.forEach { group ->
                        KlinaraCard(title = group.event.turkishName, footnote = group.event.explanation) {
                            group.rows.forEachIndexed { index, row ->
                                if (index > 0) KlinaraDivider()
                                TemplateListRow(row, onClick = { onOpen(row.template.rowId) })
                            }
                        }
                    }
                }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TemplateListRow(
    row: TemplateRow,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val template = row.template
    val interaction = remember { MutableInteractionSource() }
    Column(
        modifier = Modifier.fillMaxWidth().klinaraClickable(true, Role.Button, interaction, onClick),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            Text(template.channel.turkishName, style = KlinaraType.bodyEmphasis, color = colors.charcoal)
            when {
                row.isMissing -> KlinaraBadge("Şablon yok", tone = KlinaraBadgeTone.Warning)
                template.isDefault -> KlinaraBadge("Varsayılan", tone = KlinaraBadgeTone.Muted)
            }
            if (!template.isActive) KlinaraBadge("Pasif", tone = KlinaraBadgeTone.Warning)
            // Sağlayıcısı olmayan kanal kaydedilir ama gönderim yapmaz; bunu aramak kullanıcının işi değil.
            if (!template.channel.isDeliverable) KlinaraBadge("Kanal kurulu değil", tone = KlinaraBadgeTone.Muted)
        }
        Text(
            template.body.ifEmpty { "(metin yok)" },
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        template.whatsappTemplateName?.let {
            Text("Meta şablonu: $it", style = KlinaraType.bodyM, color = colors.charcoalMuted)
        }
    }
}

/**
 * Şablon editörü (A8.2) — iOS `NotificationTemplateEditorView` paritesi; sheet değil route.
 *
 * Olay ve kanal değiştirilemez (upsert anahtarı); yer tutucu metnin sonuna eklenir; WhatsApp'ta
 * gövde gönderimin metni gibi sunulmaz — Meta'ya giden onaylı template'tir (Ek M).
 */
@Composable
fun NotificationTemplateEditorScreen(
    state: TemplateEditorUiState,
    row: TemplateRow,
    canWrite: Boolean,
    onUpdate: ((NotificationTemplateForm) -> NotificationTemplateForm) -> Unit,
    onSave: () -> Unit,
    onDismissError: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val form = state.form
    Box {
        KlinaraScreen(title = form.event.turkishName, modifier = modifier, onBack = onBack) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = onDismissError) }
            ScopeCard(row)
            BodyCard(form, state.fieldErrors, canWrite, onUpdate)
            if (form.usesWhatsAppTemplate) WhatsAppCard(form, state.fieldErrors, canWrite, onUpdate)
            KlinaraCard(title = "Durum") {
                KlinaraToggleRow(
                    label = "Aktif",
                    detail = "Pasif şablonla bu olay için mesaj üretilmez.",
                    isOn = form.isActive,
                    onToggle = { on -> onUpdate { it.copy(isActive = on) } },
                    enabled = canWrite,
                )
            }
            if (canWrite) {
                KlinaraButton(
                    title = "Kaydet",
                    onClick = onSave,
                    enabled = form.isValid && (form.isDirty || row.isMissing || form.wasDefault),
                    isLoading = state.isSaving,
                )
            }
        }
        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }
}

@Composable
private fun ScopeCard(row: TemplateRow) {
    val template = row.template
    val colors = KlinaraTheme.colors
    KlinaraCard(title = "Kapsam") {
        KlinaraRow(label = "Olay", value = template.event.turkishName)
        KlinaraDivider()
        KlinaraRow(label = "Kanal", value = template.channel.turkishName)
        KlinaraDivider()
        KlinaraRow(label = "Tür", value = template.kind.turkishName, detail = template.kind.explanation)
        val note =
            when {
                row.isMissing ->
                    "Bu kanal için henüz şablon yok. Kaydettiğinizde bu kiracıya özel bir şablon oluşur."
                template.isDefault ->
                    "Şu anda kod içindeki varsayılan metin geçerli. Kaydettiğinizde bu kiracıya özel bir şablon oluşur."
                else -> null
            }
        note?.let {
            KlinaraDivider()
            Text(it, style = KlinaraType.bodyM, color = colors.charcoalMuted)
        }
        if (!template.channel.isDeliverable) {
            KlinaraDivider()
            Text(
                "Bu kanalın sağlayıcısı henüz kurulmadı; şablon kaydedilir ama mesaj gönderilmez.",
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BodyCard(
    form: NotificationTemplateForm,
    fieldErrors: Map<String, String>,
    canWrite: Boolean,
    onUpdate: ((NotificationTemplateForm) -> NotificationTemplateForm) -> Unit,
) {
    val colors = KlinaraTheme.colors
    KlinaraCard(title = "Metin", footnote = "Değişkenler gönderim anında müşteri ve randevu bilgisiyle doldurulur.") {
        if (form.usesSubject) {
            KlinaraTextField(
                label = "Konu",
                value = form.subject,
                onValueChange = { text -> onUpdate { it.copy(subject = text) } },
                placeholder = "E-posta konusu",
                error = fieldErrors["subject"],
                enabled = canWrite,
            )
        }
        KlinaraTextEditor(
            label = "Gövde",
            value = form.body,
            onValueChange = { text -> onUpdate { it.copy(body = text) } },
            placeholder = "Sayın {{customerName}}, …",
            error = fieldErrors["body"],
            enabled = canWrite,
            minHeight = EDITOR_MIN_HEIGHT,
        )
        Text(
            KlinaraType.labelText("Kullanılabilecek değişkenler"),
            style = KlinaraType.label,
            color = colors.charcoalMuted,
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        ) {
            form.allowedVariables.forEach { name ->
                SelectableChip(
                    label = "{{$name}}",
                    isSelected = "{{$name}}" in form.body,
                    onClick = { if (canWrite) onUpdate { it.appendingVariable(name) } },
                )
            }
        }
        // Sunucunun 422'sini beklemeden: kullanıcı hatayı yazarken görmeli.
        if (form.unknownPlaceholders.isNotEmpty()) {
            Text(
                "Tanımsız değişken: ${form.unknownPlaceholders.joinToString(", ")}",
                style = KlinaraType.bodyM,
                color = colors.danger,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WhatsAppCard(
    form: NotificationTemplateForm,
    fieldErrors: Map<String, String>,
    canWrite: Boolean,
    onUpdate: ((NotificationTemplateForm) -> NotificationTemplateForm) -> Unit,
) {
    val colors = KlinaraTheme.colors
    KlinaraCard(
        title = "WhatsApp şablonu",
        footnote =
            "WhatsApp'a giden metin Meta'da onaylı template'tir. Buradaki eşleme, template'in " +
                "{{1}}, {{2}}… sırasına hangi değişkenin gideceğini söyler.",
    ) {
        KlinaraTextField(
            label = "Meta şablon adı",
            value = form.whatsappTemplateName,
            onValueChange = { text -> onUpdate { it.copy(whatsappTemplateName = text) } },
            placeholder = "randevu_hatirlatma",
            error = fieldErrors["whatsappTemplateName"],
            enabled = canWrite,
        )
        KlinaraTextField(
            label = "Şablon dili",
            value = form.whatsappTemplateLanguage,
            onValueChange = { text -> onUpdate { it.copy(whatsappTemplateLanguage = text) } },
            placeholder = "tr",
            error =
                fieldErrors["whatsappTemplateLanguage"]
                    ?: "Şablon adı verildiyse dil zorunlu.".takeIf {
                        form.whatsappTemplateName.isNotBlank() && form.whatsappTemplateLanguage.isBlank()
                    },
            enabled = canWrite,
        )
        Text(KlinaraType.labelText("Konumsal değişkenler"), style = KlinaraType.label, color = colors.charcoalMuted)
        if (form.whatsappVariables.isEmpty()) {
            Text("Henüz eşleme yok. Aşağıdan sırayla ekleyin.", style = KlinaraType.bodyM, color = colors.charcoalMuted)
        } else {
            form.whatsappVariables.forEachIndexed { index, name ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("{{${index + 1}}}", style = KlinaraType.bodyM, color = colors.charcoalMuted)
                    Text(
                        name,
                        style = KlinaraType.bodyM,
                        color = colors.charcoal,
                        modifier = Modifier.weight(1f).padding(start = KlinaraMetrics.sm),
                    )
                    if (canWrite) {
                        IconButton(onClick = { onUpdate { it.removingWhatsAppVariable(index) } }) {
                            Icon(Icons.Filled.Close, contentDescription = "${index + 1}. değişkeni kaldır")
                        }
                    }
                }
            }
        }
        if (canWrite) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
                verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            ) {
                form.allowedVariables.filterNot { it in form.whatsappVariables }.forEach { name ->
                    SelectableChip(
                        label = name,
                        isSelected = false,
                        onClick = { onUpdate { it.addingWhatsAppVariable(name) } },
                    )
                }
            }
        }
    }
}

private val EDITOR_MIN_HEIGHT = 140.dp
