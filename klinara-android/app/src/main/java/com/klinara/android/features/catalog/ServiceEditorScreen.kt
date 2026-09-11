package com.klinara.android.features.catalog

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.ColorSwatchPicker
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.FieldErrorText
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraMoneyField
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.designsystem.components.KlinaraSelectableRow
import com.klinara.android.designsystem.components.KlinaraStepperRow
import com.klinara.android.designsystem.components.KlinaraTextEditor
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.formatting.DurationFormat
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.formatting.VatRate
import com.klinara.android.services.networking.Loadable

/**
 * Hizmet oluşturma ve düzenleme (A7.1) — iOS `ServiceEditorView` paritesi.
 *
 * iOS'ta bir sheet; Android'de bir `NavHost` hedefi (Kural 2): uzun, kaydırılan bir form ve
 * sistem geri tuşu/predictive back bedava. `service:write` yoksa ekran **salt okunur**
 * açılır — iOS da satırı yazma izni olmayana açıyor, fiyatı ve süreyi görmek resepsiyon için
 * anlamlı.
 */
@Composable
fun ServiceEditorScreen(
    session: AppSession,
    container: ServiceContainer,
    serviceId: String?,
    onBack: () -> Unit,
    onSaved: (ClinicService) -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: ServiceEditorViewModel =
        viewModel(
            key = "service-editor-${serviceId ?: "new"}",
            factory = ServiceEditorViewModel.factory(container, serviceId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canWrite = session.can(Permissions.SERVICE_WRITE)

    LaunchedEffect(serviceId) { viewModel.load() }
    LaunchedEffect(state.saved) { state.saved?.let(onSaved) }

    Box {
        KlinaraScreen(
            title = if (viewModel.isNew) "Yeni hizmet" else if (canWrite) "Hizmeti düzenle" else "Hizmet",
            modifier = modifier,
            onBack = onBack,
        ) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }

            when (val loaded = state.loaded) {
                Loadable.Loading ->
                    Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
                is Loadable.Failed ->
                    ErrorBanner(message = loaded.message, onRetry = if (loaded.isRetryable) viewModel::load else null)
                is Loadable.Loaded -> {
                    DefinitionCard(state = state, canWrite = canWrite, viewModel = viewModel)
                    DurationCard(form = state.form, canWrite = canWrite, viewModel = viewModel)
                    PriceCard(state = state, canWrite = canWrite, viewModel = viewModel)
                    AppearanceCard(form = state.form, canWrite = canWrite, viewModel = viewModel)
                    // Tek şubeli kiracıda çizilmez: fark tanımlanacak ikinci bir şube yok.
                    if (session.branches.size > 1) {
                        BranchOverridesCard(
                            form = state.form,
                            branches = session.branches,
                            canWrite = canWrite,
                            viewModel = viewModel,
                        )
                    }
                    if (canWrite) {
                        KlinaraButton(
                            title = if (viewModel.isNew) "Hizmeti oluştur" else "Kaydet",
                            onClick = viewModel::save,
                            enabled = state.form.isValid && state.form.isDirty,
                            isLoading = state.isSaving,
                        )
                    }
                }
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }
}

@Composable
private fun DefinitionCard(
    state: ServiceEditorUiState,
    canWrite: Boolean,
    viewModel: ServiceEditorViewModel,
) {
    val form = state.form
    KlinaraCard(title = "Tanım") {
        KlinaraTextField(
            label = "Hizmet adı",
            value = form.name,
            onValueChange = { value -> viewModel.update { it.withName(value) } },
            placeholder = "Tüm Vücut Lazer Epilasyon",
            error = state.fieldErrors["name"],
            enabled = canWrite,
        )
        KlinaraTextField(
            label = "Kod (slug)",
            value = form.slug,
            onValueChange = { value -> viewModel.update { it.withSlug(value) } },
            placeholder = "tum-vucut-lazer",
            error = form.slugError ?: state.fieldErrors["slug"],
            enabled = canWrite,
        )
        KlinaraTextEditor(
            label = "Açıklama",
            value = form.description,
            onValueChange = { value -> viewModel.update { it.copy(description = value) } },
            placeholder = "İsteğe bağlı",
            error = state.fieldErrors["description"],
            enabled = canWrite,
        )
    }

    KlinaraCard(title = "Kategori", footnote = state.fieldErrors["categoryId"]) {
        when (val categories = state.categories) {
            Loadable.Loading ->
                Text("Kategoriler yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            is Loadable.Failed -> ErrorBanner(message = categories.message)
            is Loadable.Loaded ->
                if (state.categoryOptions.isEmpty()) {
                    // Kategorisiz hizmet oluşturulamaz (sunucu `categoryId` istiyor); kullanıcıya
                    // "kaydet neden pasif" sorusunun cevabı burada.
                    KlinaraRow(
                        label = "Aktif kategori yok",
                        detail = "Önce Kategoriler ekranından bir kategori ekleyin",
                    )
                } else {
                    state.categoryOptions.forEachIndexed { index, category ->
                        if (index > 0) KlinaraDivider()
                        KlinaraSelectableRow(
                            title = category.name,
                            detail = if (category.isActive) null else "Pasif",
                            isSelected = category.id == form.categoryId,
                            onClick = { viewModel.update { it.copy(categoryId = category.id) } },
                            enabled = canWrite,
                        )
                    }
                }
        }
    }
}

@Composable
private fun DurationCard(
    form: ServiceForm,
    canWrite: Boolean,
    viewModel: ServiceEditorViewModel,
) {
    KlinaraCard(
        title = "Süre",
        footnote =
            "Hazırlık ve temizlik payı takvimde bloke edilir ama müşteriye gösterilen saate dâhil değildir. " +
                "Toplam: ${DurationFormat.format(form.occupiedMinutes)}.",
    ) {
        KlinaraStepperRow(
            label = "İşlem süresi",
            value = form.durationMinutes,
            onValueChange = { value -> viewModel.update { it.copy(durationMinutes = value) } },
            range = ServiceForm.DURATION_RANGE,
            step = ServiceForm.MINUTE_STEP,
            enabled = canWrite,
            format = DurationFormat::format,
        )
        KlinaraDivider()
        KlinaraStepperRow(
            label = "Hazırlık payı",
            detail = "Randevudan önce",
            value = form.bufferBeforeMinutes,
            onValueChange = { value -> viewModel.update { it.copy(bufferBeforeMinutes = value) } },
            range = ServiceForm.BUFFER_RANGE,
            step = ServiceForm.MINUTE_STEP,
            enabled = canWrite,
            format = { "$it dk" },
        )
        KlinaraStepperRow(
            label = "Temizlik payı",
            detail = "Randevudan sonra",
            value = form.bufferAfterMinutes,
            onValueChange = { value -> viewModel.update { it.copy(bufferAfterMinutes = value) } },
            range = ServiceForm.BUFFER_RANGE,
            step = ServiceForm.MINUTE_STEP,
            enabled = canWrite,
            format = { "$it dk" },
        )
    }
}

@Composable
private fun PriceCard(
    state: ServiceEditorUiState,
    canWrite: Boolean,
    viewModel: ServiceEditorViewModel,
) {
    val form = state.form
    KlinaraCard(title = "Fiyat") {
        KlinaraMoneyField(
            label = "Fiyat",
            valueMinor = form.priceMinor,
            onValueChange = { value -> viewModel.update { it.copy(priceMinor = value) } },
            parse = Money::parse,
            format = Money::formatPlain,
            error = state.fieldErrors["priceMinor"],
            enabled = canWrite,
        )
        Text("KDV ORANI", style = KlinaraType.label, color = KlinaraTheme.colors.charcoalMuted)
        // Listede olmayan bir oran (web-admin'den %1 girilmiş) seçenek olarak eklenir:
        // eklenmezse hiçbir parça seçili görünmez ve kayıt "oran yok" gibi okunur.
        val options = (VatRate.common + form.vatRateBasisPoints).distinct().sorted()
        KlinaraSegmentedPicker(
            options = options,
            selected = form.vatRateBasisPoints,
            onSelect = { value -> if (canWrite) viewModel.update { it.copy(vatRateBasisPoints = value) } },
            title = VatRate::format,
            modifier = Modifier.fillMaxWidth(),
        )
        FieldErrorText(state.fieldErrors["vatRateBasisPoints"])
    }
}

@Composable
private fun AppearanceCard(
    form: ServiceForm,
    canWrite: Boolean,
    viewModel: ServiceEditorViewModel,
) {
    KlinaraCard(title = "Görünüm ve yayın") {
        ColorSwatchPicker(
            selected = form.calendarColor,
            onSelect = { value -> if (canWrite) viewModel.update { it.copy(calendarColor = value) } },
            label = "Takvim rengi",
        )
        KlinaraDivider()
        KlinaraToggleRow(
            label = "Online randevuya açık",
            detail = "Müşteriler bu hizmeti kendileri seçebilir",
            isOn = form.isOnlineBookable,
            onToggle = { value -> viewModel.update { it.copy(isOnlineBookable = value) } },
            enabled = canWrite,
        )
        KlinaraToggleRow(
            label = "Aktif",
            detail = "Pasif hizmet yeni randevularda seçilemez",
            isOn = form.isActive,
            onToggle = { value -> viewModel.update { it.copy(isActive = value) } },
            enabled = canWrite,
        )
    }
}

/**
 * Şube farkları — yalnız fiyat ve süre (iOS gibi). Boş bırakılan alan hizmetin genel
 * değerini kullanır; sunucudaki diğer override alanları formda korunur.
 */
@Composable
private fun BranchOverridesCard(
    form: ServiceForm,
    branches: List<BranchSummary>,
    canWrite: Boolean,
    viewModel: ServiceEditorViewModel,
) {
    KlinaraCard(title = "Şube farkları", footnote = "Boş bırakılan alanlar hizmetin genel değerini kullanır.") {
        branches.forEachIndexed { index, branch ->
            if (index > 0) KlinaraDivider()
            val override = form.override(branch.id)
            KlinaraRow(
                label = branch.name,
                accessory = { if (override != null) KlinaraBadge("Özel") },
            )
            KlinaraMoneyField(
                label = "Fiyat",
                valueMinor = override?.priceMinor,
                onValueChange = { value -> viewModel.update { it.withOverridePrice(branch.id, value) } },
                parse = Money::parse,
                format = Money::formatPlain,
                placeholder = "Genel fiyat",
                enabled = canWrite,
            )
            val customMinutes = override?.durationMinutes
            KlinaraToggleRow(
                label = "Şubeye özel süre",
                detail = if (customMinutes == null) "Genel değer kullanılıyor" else null,
                isOn = customMinutes != null,
                onToggle = { on ->
                    viewModel.update {
                        it.withOverrideDuration(branch.id, if (on) it.durationMinutes else null)
                    }
                },
                enabled = canWrite,
            )
            if (customMinutes != null) {
                KlinaraStepperRow(
                    label = "Süre",
                    value = customMinutes,
                    onValueChange = { value -> viewModel.update { it.withOverrideDuration(branch.id, value) } },
                    range = ServiceForm.DURATION_RANGE,
                    step = ServiceForm.MINUTE_STEP,
                    enabled = canWrite,
                    format = DurationFormat::format,
                )
            }
        }
    }
}
