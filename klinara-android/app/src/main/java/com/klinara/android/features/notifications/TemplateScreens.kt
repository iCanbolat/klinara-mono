package com.klinara.android.features.notifications

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextOverflow
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.services.notifications.TemplateSegment
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
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.NotificationEventCatalog

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
                "Mesajları görüntüleyebilirsiniz; açıp kapatmak için bildirim yönetimi izni gerekir.",
                style = KlinaraType.bodyM,
                color = KlinaraTheme.colors.charcoalMuted,
            )
        }
        when (templates) {
            Loadable.Loading ->
                KlinaraSkeleton(style = KlinaraSkeletonStyle.rows)
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
            if (row.isMissing) {
                KlinaraBadge("Hazır metin yok", tone = KlinaraBadgeTone.Warning)
            } else if (!template.isActive) {
                KlinaraBadge("Kapalı", tone = KlinaraBadgeTone.Warning)
            }
        }
        Text(
            templateText(template.displaySegments, emptyLabel = "(metin yok)"),
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Şablon detayı (A8.2) — iOS `NotificationTemplateEditorView` paritesi; sheet değil route.
 *
 * Sade: müşterinin göreceği mesaj salt okunur, tek düzenlenebilir şey "gönderilsin" anahtarı.
 * Meta şablon adı, dil ve değişken eşlemesi teknik ayrıntıdır; ekranda yer almaz ve değiştirilemez.
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
    val colors = KlinaraTheme.colors
    Box {
        KlinaraScreen(title = form.event.turkishName, modifier = modifier, onBack = onBack) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = onDismissError) }
            Text(form.event.explanation, style = KlinaraType.bodyM, color = colors.charcoalMuted)
            KlinaraCard(
                title = "Müşteriye giden mesaj",
                footnote = "Mavi @ ile başlayan bilgiler gönderim anında müşteriye özel doldurulur.",
            ) {
                val text =
                    if (row.isMissing) {
                        AnnotatedString("Bu mesaj için henüz hazır bir metin yok.")
                    } else {
                        templateText(form.segments, emptyLabel = "(metin yok)")
                    }
                Text(
                    text,
                    style = KlinaraType.bodyM,
                    color = if (row.isMissing) colors.charcoalMuted else colors.charcoal,
                )
            }
            state.branch?.let { branch ->
                KlinaraCard(
                    title = "Klinik konumu",
                    footnote =
                        "Adres, randevu mesajlarında müşteriye gösterilir; mesajdaki \"Haritada aç\" butonu bu " +
                            "adresten oluşturulur. Adresi şube ayarlarından değiştirebilirsiniz. Şube: ${branch.name}.",
                ) {
                    KlinaraRow(label = "Adres", value = branch.address?.takeIf { it.isNotBlank() } ?: "Girilmemiş")
                }
            }
            if (!row.isMissing) {
                KlinaraCard(title = "Gönderim") {
                    KlinaraToggleRow(
                        label = "Bu mesaj gönderilsin",
                        detail = "Kapalıyken müşteriye bu mesaj gitmez.",
                        isOn = form.isActive,
                        onToggle = { on -> onUpdate { it.copy(isActive = on) } },
                        enabled = canWrite,
                    )
                }
            }
            if (canWrite && (!row.isMissing || state.branch != null)) {
                KlinaraButton(
                    title = "Kaydet",
                    onClick = onSave,
                    enabled = state.canSave,
                    isLoading = state.isSaving,
                )
            }
        }
        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }
}

/**
 * Şablon gövdesi: düz metin olduğu gibi, değişkenler `@Etiket` olarak mavi bağlantı renginde.
 * iOS `[TemplateSegment].attributed()` paritesi.
 */
@Composable
internal fun templateText(
    segments: List<TemplateSegment>,
    emptyLabel: String,
): AnnotatedString {
    val link = KlinaraTheme.colors.link
    return remember(segments, link, emptyLabel) {
        if (segments.isEmpty()) {
            AnnotatedString(emptyLabel)
        } else {
            buildAnnotatedString {
                segments.forEach { segment ->
                    if (segment.isVariable) {
                        withStyle(SpanStyle(color = link, fontWeight = FontWeight.SemiBold)) { append(segment.display) }
                    } else {
                        append(segment.text)
                    }
                }
            }
        }
    }
}
