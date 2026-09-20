package com.klinara.android.features.integrations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
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
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSelectableRow
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.PhoneNumberField
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.integrations.WhatsAppAccount
import com.klinara.android.services.integrations.WhatsAppTemplate
import com.klinara.android.services.integrations.WhatsAppVerifyResult
import com.klinara.android.services.networking.Loadable

/** Ayar ekranının geri çağrıları. */
data class WhatsAppSettingsActions(
    val onRetry: () -> Unit,
    val onVerify: () -> Unit,
    val onEdit: () -> Unit,
    val onOpenTemplates: () -> Unit,
    /** `null` → test düğmesi hiç çizilmez (`notification:send` yok). */
    val onTest: (() -> Unit)?,
    val onDismissError: () -> Unit,
)

/**
 * WhatsApp entegrasyonu (A8.3) — iOS `WhatsAppSettingsView` paritesi.
 *
 * Kurulmamış hesap bir **boş durum**, hata değil: sunucu gövdeyi düpedüz boş döndürüyor ve
 * kırmızı bir bantla karşılanan kullanıcı henüz yapmadığı bir şeyin bozulduğunu sanırdı.
 */
@Composable
fun WhatsAppSettingsScreen(
    state: WhatsAppUiState,
    clock: BranchClock,
    actions: WhatsAppSettingsActions,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box {
        KlinaraScreen(title = "WhatsApp entegrasyonu", modifier = modifier, onBack = onBack) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = actions.onDismissError) }
            when (val account = state.account) {
                Loadable.Loading ->
                    KlinaraSkeleton(style = KlinaraSkeletonStyle.rowsShort)
                is Loadable.Failed ->
                    ErrorBanner(message = account.message, onRetry = if (account.isRetryable) actions.onRetry else null)
                is Loadable.Loaded -> {
                    val value = account.value
                    if (value == null) {
                        EmptyStateView(
                            title = "WhatsApp bağlı değil",
                            message =
                                "Meta Business hesabınızın WABA kimliği, telefon numarası kimliği ve erişim " +
                                    "token'ı gerekir.",
                            icon = Icons.Filled.Share,
                            actionTitle = "Yapılandır",
                            actionIcon = Icons.Filled.Settings,
                            onAction = actions.onEdit,
                        )
                    } else {
                        StatusCard(value, clock)
                        state.lastVerify?.let { VerifyResultCard(it) }
                        ActionsCard(state.isVerifying, actions)
                    }
                }
            }
        }
        if (state.isVerifying) AuthLoadingOverlay(message = "Bağlantı doğrulanıyor…")
    }
}

@Composable
private fun StatusCard(
    account: WhatsAppAccount,
    clock: BranchClock,
) {
    KlinaraCard(title = "Durum") {
        KlinaraRow(
            label = "Bağlantı",
            accessory = { KlinaraBadge(account.status.turkishName, tone = account.status.badgeTone) },
        )
        KlinaraDivider()
        KlinaraRow(label = "WABA kimliği", value = account.wabaId)
        KlinaraDivider()
        KlinaraRow(label = "Telefon numarası kimliği", value = account.phoneNumberId)
        account.businessPhone?.let {
            KlinaraDivider()
            KlinaraRow(label = "İşletme numarası", value = it)
        }
        KlinaraDivider()
        KlinaraRow(label = "API sürümü", value = account.apiVersion)
        KlinaraDivider()
        // Ham token hiçbir yanıtta yok; maskeli değer yalnız "hangi token'ı girdim?" sorusuna yarar.
        KlinaraRow(
            label = "Erişim token'ı",
            value = account.accessTokenMasked,
            detail = "Token okunamaz; değiştirmek için yeniden girilmelidir.",
        )
        KlinaraDivider()
        // İmza doğrulanamazsa gelen kutusu hiç dolmaz — kurulumun en sık gözden kaçan eksiği.
        KlinaraRow(
            label = "Webhook imzası",
            value = if (account.hasAppSecret) "Doğrulanabilir" else "App secret yok",
            detail =
                "App secret girilmeden gelen mesajlar işlenmez; gelen kutusu boş kalır."
                    .takeUnless { account.hasAppSecret },
        )
        account.lastVerifiedAt?.let {
            KlinaraDivider()
            KlinaraRow(label = "Son doğrulama", value = clock.formatDateTime(it))
        }
        account.lastError?.let {
            KlinaraDivider()
            KlinaraRow(label = "Son hata", value = it)
        }
    }
}

@Composable
private fun VerifyResultCard(result: WhatsAppVerifyResult) {
    val colors = KlinaraTheme.colors
    KlinaraCard(title = "Doğrulama sonucu") {
        KlinaraRow(
            label = if (result.ok) "Bağlantı doğrulandı" else "Bağlantı doğrulanamadı",
            accessory = {
                KlinaraBadge(
                    if (result.ok) "Başarılı" else "Başarısız",
                    tone = if (result.ok) KlinaraBadgeTone.Positive else KlinaraBadgeTone.Warning,
                )
            },
        )
        result.error?.let { Text(it, style = KlinaraType.bodyM, color = colors.charcoal) }
        if (result.ok) {
            Text(
                "Senkronlanan şablon: ${result.templateCount}",
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
            )
        }
    }
}

@Composable
private fun ActionsCard(
    isVerifying: Boolean,
    actions: WhatsAppSettingsActions,
) {
    KlinaraCard(title = "İşlemler") {
        KlinaraNavigationRow(
            label = "Onaylı şablonlar",
            value = "Meta'dan senkronlanan template'ler ve onay durumları",
            onClick = actions.onOpenTemplates,
            modifier = Modifier.fillMaxWidth(),
        )
        KlinaraDivider()
        KlinaraButton(
            title = "Bağlantıyı doğrula",
            onClick = actions.onVerify,
            kind = KlinaraButtonKind.Secondary,
            isLoading = isVerifying,
        )
        actions.onTest?.let {
            KlinaraButton(
                title = "Test mesajı gönder",
                onClick = it,
                kind = KlinaraButtonKind.Secondary,
                enabled = !isVerifying,
            )
        }
        KlinaraButton(
            title = "Kimlik bilgilerini güncelle",
            onClick = actions.onEdit,
            kind = KlinaraButtonKind.Secondary,
            enabled = !isVerifying,
        )
    }
}

/**
 * Kimlik bilgileri (A8.3) — iOS `WhatsAppSettingsEditorView`; sheet değil route.
 *
 * Token ve app secret gizli alanda girilir ve hiçbir yere yazılmaz (ViewModel dışında durum yok).
 */
@Suppress("LongMethod")
@Composable
fun WhatsAppSettingsEditorScreen(
    state: WhatsAppEditorUiState,
    onUpdate: ((WhatsAppAccountDraft) -> WhatsAppAccountDraft) -> Unit,
    onSave: () -> Unit,
    onDismissError: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val draft = state.draft
    val existing = draft.existing
    val colors = KlinaraTheme.colors
    Box {
        KlinaraScreen(
            title = if (existing == null) "WhatsApp kurulumu" else "Kimlik bilgileri",
            modifier = modifier,
            onBack = onBack,
        ) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = onDismissError) }
            KlinaraCard(
                title = "Hesap",
                footnote = "Bu değerler Meta Business Manager'daki WhatsApp hesabınızın ayarlar sayfasında yazılıdır.",
            ) {
                KlinaraTextField(
                    label = "WABA kimliği",
                    value = draft.wabaId,
                    onValueChange = { text -> onUpdate { it.copy(wabaId = text) } },
                    placeholder = "1029384756",
                    error = state.fieldErrors["wabaId"],
                    keyboardType = KeyboardType.Number,
                )
                KlinaraTextField(
                    label = "Telefon numarası kimliği",
                    value = draft.phoneNumberId,
                    onValueChange = { text -> onUpdate { it.copy(phoneNumberId = text) } },
                    placeholder = "5647382910",
                    error = state.fieldErrors["phoneNumberId"],
                    keyboardType = KeyboardType.Number,
                )
                KlinaraTextField(
                    label = "İşletme numarası (isteğe bağlı)",
                    value = draft.businessPhone,
                    onValueChange = { text -> onUpdate { it.copy(businessPhone = text) } },
                    placeholder = "+902121234567",
                    error = state.fieldErrors["businessPhone"],
                    keyboardType = KeyboardType.Phone,
                )
            }
            KlinaraCard(
                title = "Gizli bilgiler",
                footnote = "Token ve app secret sunucuda şifreli saklanır ve hiçbir yanıtta geri dönmez.",
            ) {
                KlinaraTextField(
                    label = "Erişim token'ı",
                    value = draft.accessToken,
                    onValueChange = { text -> onUpdate { it.copy(accessToken = text) } },
                    placeholder = "EAAG…",
                    error = state.fieldErrors["accessToken"] ?: draft.tokenError,
                    isSecure = true,
                )
                existing?.let {
                    Text(
                        "Kayıtlı token okunamaz (${it.accessTokenMasked}). Kaydetmek için token'ı yeniden " +
                            "girmelisiniz.",
                        style = KlinaraType.bodyM,
                        color = colors.charcoalMuted,
                    )
                }
                KlinaraTextField(
                    label = "App secret (isteğe bağlı)",
                    value = draft.appSecret,
                    onValueChange = { text -> onUpdate { it.copy(appSecret = text) } },
                    placeholder =
                        if (existing?.hasAppSecret == true) {
                            "Değiştirmek için doldurun"
                        } else {
                            "Meta uygulama gizli anahtarı"
                        },
                    error = state.fieldErrors["appSecret"] ?: draft.appSecretError,
                    isSecure = true,
                )
                Text(
                    // [S] A8.3'ten sonra doğru: sunucu boş bırakılan secret'ı artık koruyor.
                    if (existing?.hasAppSecret == true) {
                        "Kayıtlı bir app secret var. Boş bırakırsanız korunur."
                    } else {
                        "App secret girilmeden gelen mesajlar doğrulanamaz ve gelen kutusu boş kalır."
                    },
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                )
            }
            KlinaraCard(
                title = "Gelişmiş",
                footnote =
                    "Kaydettiğinizde bağlantı doğrulanmamış duruma döner; ardından \"Bağlantıyı doğrula\" ile sınayın.",
            ) {
                KlinaraTextField(
                    label = "Graph API sürümü",
                    value = draft.apiVersion,
                    onValueChange = { text -> onUpdate { it.copy(apiVersion = text) } },
                    placeholder = "v21.0",
                    error = state.fieldErrors["apiVersion"] ?: draft.apiVersionError,
                )
            }
            KlinaraButton(
                title = "Kaydet",
                onClick = onSave,
                enabled = draft.isValid && draft.isDirty,
                isLoading = state.isSaving,
            )
        }
        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }
}

/** Meta şablonları (A8.3) — iOS `WhatsAppTemplateListView`. Salt okunur: metinler Meta'da tanımlı. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WhatsAppTemplateListScreen(
    templates: Loadable<List<WhatsAppTemplate>>,
    clock: BranchClock,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    KlinaraScreen(title = "Onaylı şablonlar", modifier = modifier, onBack = onBack) {
        when (templates) {
            Loadable.Loading -> KlinaraSkeleton(style = KlinaraSkeletonStyle.cardsShort)
            is Loadable.Failed ->
                ErrorBanner(message = templates.message, onRetry = if (templates.isRetryable) onRetry else null)
            is Loadable.Loaded ->
                if (templates.value.isEmpty()) {
                    EmptyStateView(
                        title = "Şablon yok",
                        message = "Bağlantıyı doğruladığınızda Meta'daki şablonlar buraya senkronlanır.",
                        icon = Icons.Filled.Share,
                    )
                } else {
                    KlinaraCard(
                        title = "Meta şablonları",
                        footnote =
                            "Bu metinler Meta'da tanımlıdır ve buradan değiştirilemez. Onay süreci Meta Business " +
                                "Manager'dan yürür.",
                    ) {
                        templates.value.forEachIndexed { index, template ->
                            if (index > 0) KlinaraDivider()
                            TemplateRow(template, clock)
                        }
                    }
                }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TemplateRow(
    template: WhatsAppTemplate,
    clock: BranchClock,
) {
    val colors = KlinaraTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                template.name,
                style = KlinaraType.bodyEmphasis,
                color = colors.charcoal,
                modifier = Modifier.weight(1f),
            )
            KlinaraBadge(template.status.turkishName, tone = template.status.badgeTone)
        }
        Text(
            listOfNotNull(template.language.uppercase(), template.category).joinToString(" · "),
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
        )
        Text(
            if (template.bodyVariableCount == 0) {
                "Değişken beklemiyor"
            } else {
                "${template.bodyVariableCount} değişken bekliyor ({{1}}…{{${template.bodyVariableCount}}})"
            },
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
        )
        if (template.buttons.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
                template.buttons.forEach { KlinaraBadge(it.text) }
            }
        }
        template.syncedAt?.let {
            Text("Senkron: ${clock.formatDateTime(it)}", style = KlinaraType.bodyM, color = colors.charcoalMuted)
        }
    }
}

/**
 * Test mesajı (A8.3) — iOS `WhatsAppTestSheet`. Liste **değişkensiz onaylı** şablonlarla sınırlı:
 * sunucu testi `parameters: []` ile gönderiyor ve değişkenli bir şablon Meta'da reddedilir.
 */
@Suppress("LongParameterList")
@Composable
fun WhatsAppTestScreen(
    state: WhatsAppTestUiState,
    testable: List<WhatsAppTemplate>,
    hasAnyTemplate: Boolean,
    onPhone: (String) -> Unit,
    onSelect: (WhatsAppTemplate) -> Unit,
    onSend: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    Box {
        KlinaraScreen(title = "Test mesajı", modifier = modifier, onBack = onBack) {
            state.error?.let { ErrorBanner(message = it, onRetry = if (state.isRetryable) onSend else null) }
            KlinaraCard(
                title = "Alıcı",
                footnote = "Numaranın WhatsApp'ta kayıtlı olması gerekir. Test gönderimi mesaj günlüğüne de yazılır.",
            ) {
                PhoneNumberField(
                    label = "Telefon",
                    e164 = state.phone,
                    onE164Change = onPhone,
                    error = state.fieldErrors["to"],
                )
            }
            KlinaraCard(
                title = "Şablon",
                footnote =
                    "Test gönderimi parametresiz yapılır; yalnız değişken beklemeyen onaylı şablonlar seçilebilir.",
            ) {
                if (testable.isEmpty()) {
                    Text(
                        if (hasAnyTemplate) {
                            "Değişken beklemeyen onaylı bir şablon yok. Meta'da parametresiz bir test " +
                                "şablonu oluşturun."
                        } else {
                            "Henüz senkronlanmış şablon yok. Önce bağlantıyı doğrulayın."
                        },
                        style = KlinaraType.bodyM,
                        color = colors.charcoalMuted,
                    )
                } else {
                    testable.forEachIndexed { index, template ->
                        if (index > 0) KlinaraDivider()
                        KlinaraSelectableRow(
                            title = template.name,
                            detail = template.language.uppercase(),
                            isSelected = state.selectedTemplate == template.rowId,
                            onClick = { onSelect(template) },
                        )
                    }
                }
            }
            state.result?.let { result ->
                KlinaraCard(title = "Sonuç") {
                    // Kabul ULAŞMAK değil: teslim durumu webhook'la sonradan gelir.
                    KlinaraRow(
                        label = "Durum",
                        value = if (result.accepted) "Sağlayıcı kabul etti" else "Kabul edilmedi",
                        detail = "Kabul, teslim demek değildir. Teslim durumu mesaj günlüğünde güncellenir.",
                    )
                    result.providerMessageId?.let {
                        KlinaraDivider()
                        KlinaraRow(label = "Sağlayıcı mesaj kimliği", value = it)
                    }
                }
            }
            KlinaraButton(
                title = "Gönder",
                onClick = onSend,
                enabled = state.phone.isNotBlank() && testable.any { it.rowId == state.selectedTemplate },
                isLoading = state.isSending,
            )
        }
        if (state.isSending) AuthLoadingOverlay(message = "Gönderiliyor…")
    }
}
