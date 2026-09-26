package com.klinara.android.features.conversations

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBottomSheet
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraSearchField
import com.klinara.android.designsystem.components.KlinaraSelectableRow
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.conversations.ConversationFormat
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.delay

/**
 * Pencere kapalıyken onaylı şablon gönderimi — iOS `TemplateSendSheet` paritesi.
 *
 * Değişkenler sunucunun önerisiyle dolu gelir; boş alan Gönder'e basınca KENDİ altında işaretlenir.
 */
@Composable
internal fun TemplateSendSheet(
    sheet: TemplateSheetState,
    viewModel: ConversationThreadViewModel,
) {
    val colors = KlinaraTheme.colors
    val selected = sheet.selected
    KlinaraBottomSheet(
        title = "Şablon gönder",
        onDismiss = viewModel::closeTemplates,
        confirmTitle = "Gönder",
        canConfirm = selected != null,
        isSaving = sheet.isSending,
        onConfirm = viewModel::sendTemplate,
    ) {
        Text(
            "Pencere kapalıyken yalnız Meta'nın onayladığı şablonlar gönderilebilir. Müşteri yanıt " +
                "verdiğinde pencere yeniden açılır.",
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
        )
        when (val options = sheet.options) {
            Loadable.Loading -> KlinaraSkeleton(style = KlinaraSkeletonStyle.rowsShort)
            is Loadable.Failed -> ErrorBanner(message = options.message, onRetry = viewModel::openTemplates)
            is Loadable.Loaded ->
                if (options.value.isEmpty()) {
                    Text(
                        "Gönderilebilecek onaylı şablon yok. WhatsApp ayarlarından standart şablonları " +
                            "oluşturup Meta onayını bekleyin.",
                        style = KlinaraType.bodyM,
                        color = colors.charcoal,
                    )
                } else {
                    KlinaraCard(title = "Şablon") {
                        options.value.forEachIndexed { index, option ->
                            if (index > 0) KlinaraDivider()
                            KlinaraSelectableRow(
                                title = option.name,
                                isSelected = option.key == sheet.selectedKey,
                                onClick = { viewModel.chooseTemplate(option.key) },
                            )
                        }
                    }
                }
        }

        if (selected != null) {
            repeat(selected.bodyVariableCount) { index ->
                KlinaraTextField(
                    label = selected.label(index),
                    value = sheet.values.getOrNull(index).orEmpty(),
                    onValueChange = { viewModel.setTemplateValue(index, it) },
                    error = if (sheet.missing(index)) "Bu alan zorunlu." else null,
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
                Text("ÖNİZLEME", style = KlinaraType.label, color = colors.charcoalMuted)
                Text(
                    selected.render(sheet.values),
                    style = KlinaraType.bodyL,
                    color = colors.charcoal,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .background(colors.sageSoft, RoundedCornerShape(18.dp))
                            .padding(horizontal = 14.dp, vertical = 10.dp)
                            .semantics { contentDescription = "Önizleme: ${selected.render(sheet.values)}" },
                )
            }
        }
        sheet.error?.let { ErrorBanner(message = it) }
    }
}

/**
 * Kayıtlı olmayan numaranın sohbetini bir müşteriye bağlar. Sohbeti açmayı engellemez:
 * bağlamadan da yazışılabilir.
 */
@Composable
internal fun LinkCustomerSheet(
    container: ServiceContainer,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<Loadable<List<Customer>>?>(null) }

    LaunchedEffect(query) {
        val term = query.trim()
        if (term.length < MIN_QUERY) {
            results = null
            return@LaunchedEffect
        }
        delay(SEARCH_DEBOUNCE_MILLIS)
        results = Loadable.Loading
        results =
            try {
                Loadable.Loaded(container.customers.search(term, limit = SEARCH_LIMIT))
            } catch (error: ApiError) {
                Loadable.failed(error)
            }
    }

    KlinaraBottomSheet(title = "Müşteriye bağla", onDismiss = onDismiss) {
        KlinaraSearchField(value = query, onValueChange = { query = it }, placeholder = "Ad ya da telefon")
        when (val found = results) {
            null -> Text("Ad ya da telefonun en az iki karakterini yazın.", style = KlinaraType.bodyM)
            Loadable.Loading -> KlinaraSkeleton(style = KlinaraSkeletonStyle.rowsShort)
            is Loadable.Failed -> ErrorBanner(message = found.message)
            is Loadable.Loaded ->
                KlinaraCard {
                    if (found.value.isEmpty()) {
                        KlinaraRow(label = "Eşleşen müşteri yok")
                    } else {
                        found.value.forEachIndexed { index, customer ->
                            if (index > 0) KlinaraDivider()
                            KlinaraSelectableRow(
                                title = customer.fullName,
                                detail = customer.phone?.let(ConversationFormat::phone),
                                isSelected = false,
                                onClick = { onPick(customer.id) },
                            )
                        }
                    }
                }
        }
    }
}

private const val MIN_QUERY = 2
private const val SEARCH_LIMIT = 20
private const val SEARCH_DEBOUNCE_MILLIS = 300L
