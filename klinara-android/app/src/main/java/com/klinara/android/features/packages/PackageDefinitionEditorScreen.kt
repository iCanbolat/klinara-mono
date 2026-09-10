package com.klinara.android.features.packages

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraMoneyField
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSearchablePicker
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.designsystem.components.KlinaraStepperRow
import com.klinara.android.designsystem.components.KlinaraTextEditor
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.PackageDefinition

/**
 * Paket tanımı oluşturma ve düzenleme (A5.1).
 *
 * Kalem listesi formun **kalbi**: bir paket birden çok hizmet içerebildiği için (10 lazer
 * + 2 bakım) kalemler tek satırlık bir adet alanına indirilemez. Satış fiyatı kalemlerin
 * liste toplamından bağımsızdır ve aradaki fark indirim olarak CANLI gösterilir.
 *
 * `package:write` yoksa ekran **salt okunur** açılır: alanlar pasif, "Kaydet" çizilmez.
 * Tanımı görmek (fiyat, kalemler) satış yapan resepsiyon için de anlamlı.
 */
@Composable
fun PackageDefinitionEditorScreen(
    session: AppSession,
    container: ServiceContainer,
    definitionId: String?,
    onBack: () -> Unit,
    onSaved: (PackageDefinition) -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: PackageDefinitionEditorViewModel =
        viewModel(
            key = "package-definition-editor-${definitionId ?: "new"}",
            factory = PackageDefinitionEditorViewModel.factory(container, definitionId, session.activeBranchId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canWrite = session.can(Permissions.PACKAGE_WRITE)

    LaunchedEffect(definitionId) { viewModel.load() }
    LaunchedEffect(state.saved) { state.saved?.let(onSaved) }

    Box {
        KlinaraScreen(
            title = if (viewModel.isNew) "Yeni paket" else if (canWrite) "Paketi düzenle" else "Paket",
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
                    EditorBody(state = state, session = session, canWrite = canWrite, viewModel = viewModel)
                    if (canWrite) {
                        KlinaraButton(
                            title = if (viewModel.isNew) "Paketi oluştur" else "Kaydet",
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
private fun EditorBody(
    state: PackageDefinitionEditorUiState,
    session: AppSession,
    canWrite: Boolean,
    viewModel: PackageDefinitionEditorViewModel,
) {
    val form = state.form

    KlinaraCard(title = "Tanım") {
        KlinaraTextField(
            label = "Paket adı",
            value = form.name,
            onValueChange = { value -> viewModel.update { it.withName(value) } },
            placeholder = "10 Seans Lazer + 2 Bakım",
            error = state.fieldErrors["name"],
            enabled = canWrite,
        )
        KlinaraTextField(
            label = "Kod (slug)",
            value = form.slug,
            onValueChange = { value -> viewModel.update { it.withSlug(value) } },
            placeholder = "lazer-10-seans",
            error = form.slugError ?: state.fieldErrors["slug"],
            // Slug satılmış paketlerin izini taşıyor; sunucu `PATCH` gövdesinde kabul de etmiyor.
            enabled = canWrite && !form.isEditing,
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

    ItemsCard(state = state, canWrite = canWrite, viewModel = viewModel)
    PricingCard(state = state, canWrite = canWrite, viewModel = viewModel)
    ScopeCard(form = form, session = session, canWrite = canWrite, viewModel = viewModel)
    RulesCard(state = state, canWrite = canWrite, viewModel = viewModel)
}

@Composable
private fun ItemsCard(
    state: PackageDefinitionEditorUiState,
    canWrite: Boolean,
    viewModel: PackageDefinitionEditorViewModel,
) {
    val form = state.form
    KlinaraCard(
        title = "Kalemler",
        footnote =
            state.fieldErrors["items"]
                ?: if (form.hasDuplicateService) {
                    "Aynı hizmet iki kez eklenemez."
                } else {
                    "Kalan hak KALEM bazında tutulur: 10 lazer + 2 bakım satılan bir pakette " +
                        "bakım hakkı lazer için kullanılamaz."
                },
    ) {
        if (form.items.isEmpty()) KlinaraRow(label = "Henüz kalem yok", detail = "En az bir hizmet ekleyin")

        form.items.forEachIndexed { index, item ->
            if (index > 0) KlinaraDivider()
            KlinaraStepperRow(
                label = item.serviceName,
                value = item.quantity,
                onValueChange = { value -> viewModel.update { it.withQuantity(item.serviceId, value) } },
                range = 1..MAX_QUANTITY,
                detail = "${Money.format(item.unitListPriceMinor)} birim · ${Money.format(item.listTotalMinor)}",
                enabled = canWrite,
                format = { "$it seans" },
            )
            if (canWrite) {
                KlinaraButton(
                    title = "Kalemi çıkar",
                    onClick = { viewModel.update { it.removing(item.serviceId) } },
                    kind = KlinaraButtonKind.Tertiary,
                )
            }
        }

        if (canWrite) {
            KlinaraDivider()
            if (state.isPickingService) {
                ServicePicker(state = state, viewModel = viewModel)
            } else {
                KlinaraButton(
                    title = "Hizmet ekle",
                    onClick = { viewModel.setPickingService(true) },
                    kind = KlinaraButtonKind.Secondary,
                )
            }
        }
    }
}

@Composable
private fun ServicePicker(
    state: PackageDefinitionEditorUiState,
    viewModel: PackageDefinitionEditorViewModel,
) {
    when (val services = state.services) {
        Loadable.Loading ->
            Text("Hizmetler yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
        is Loadable.Failed -> ErrorBanner(message = services.message)
        is Loadable.Loaded ->
            KlinaraSearchablePicker(
                options = state.addableServices,
                key = { it.id },
                label = { it.name },
                detail = { Money.format(it.priceMinor) },
                isSelected = { false },
                onSelect = viewModel::addService,
                searchLabel = "Hizmet ara",
                // Pasif hizmet listede YOK: sunucu pasif hizmeti kalem olarak reddediyor.
                emptyMessage = "Eklenebilecek aktif hizmet kalmadı.",
            )
    }
    KlinaraButton(title = "Vazgeç", onClick = { viewModel.setPickingService(false) }, kind = KlinaraButtonKind.Tertiary)
}

@Composable
private fun PricingCard(
    state: PackageDefinitionEditorUiState,
    canWrite: Boolean,
    viewModel: PackageDefinitionEditorViewModel,
) {
    val form = state.form
    KlinaraCard(
        title = "Fiyat",
        footnote =
            "Satış fiyatı kalemlerin liste toplamından bağımsızdır. " +
                "Satılmış paketler satış anındaki fiyatla yaşar.",
    ) {
        KlinaraMoneyField(
            label = "Satış fiyatı",
            valueMinor = form.totalPriceMinor,
            onValueChange = { value -> viewModel.update { it.copy(totalPriceMinor = value) } },
            parse = Money::parse,
            format = Money::formatPlain,
            error = state.fieldErrors["totalPriceMinor"],
            enabled = canWrite,
        )
        KlinaraRow(
            label = "Liste toplamı",
            value = Money.format(form.listPriceMinor),
            detail = "${form.totalSessions} seans, güncel katalog fiyatıyla",
        )
        form.discountMinor?.let { discount ->
            KlinaraDivider()
            KlinaraRow(label = "İndirim", value = Money.format(discount))
        }
    }
}

@Composable
private fun ScopeCard(
    form: PackageDefinitionForm,
    session: AppSession,
    canWrite: Boolean,
    viewModel: PackageDefinitionEditorViewModel,
) {
    val activeBranch = session.activeBranch
    KlinaraCard(
        title = "Kapsam",
        footnote =
            if (form.isEditing) {
                "Şube kapsamı satıştan sonra değiştirilemez; satılmış paketlerin izini taşır."
            } else {
                "Tüm şubeler seçilirse paket her şubede satılabilir."
            },
    ) {
        val branchName =
            form.branchId?.let { id -> session.branches.firstOrNull { it.id == id }?.name ?: "Şubeye özel" }
        if (form.isEditing || !canWrite || activeBranch == null) {
            KlinaraRow(label = "Şube", value = branchName ?: "Tüm şubeler")
        } else {
            KlinaraSegmentedPicker(
                options = listOf<String?>(null, activeBranch.id),
                selected = form.branchId,
                onSelect = { value -> viewModel.update { it.copy(branchId = value) } },
                title = { if (it == null) "Tüm şubeler" else activeBranch.name },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun RulesCard(
    state: PackageDefinitionEditorUiState,
    canWrite: Boolean,
    viewModel: PackageDefinitionEditorViewModel,
) {
    val form = state.form
    KlinaraCard(title = "Kurallar") {
        KlinaraToggleRow(
            label = "Süreli paket",
            detail = if (form.validityDays == null) "Süresiz — hak hiç yanmaz" else "Satıştan itibaren sayılır",
            isOn = form.validityDays != null,
            onToggle = { on -> viewModel.update { it.copy(validityDays = if (on) DEFAULT_VALIDITY_DAYS else null) } },
            enabled = canWrite,
        )
        form.validityDays?.let { days ->
            KlinaraTextField(
                label = "Geçerlilik (gün)",
                value = days.toString(),
                onValueChange = { raw ->
                    // Boş alan "0 gün" DEĞİL; silinirken ara değer olarak 0 tutulur ve
                    // doğrulama onu yakalar — süresiz yapmanın yolu anahtarı kapatmak.
                    val days = raw.filter(Char::isDigit).take(MAX_DAY_DIGITS).toIntOrNull() ?: 0
                    viewModel.update { it.copy(validityDays = days) }
                },
                error = form.validityError ?: state.fieldErrors["validityDays"],
                enabled = canWrite,
                keyboardType = KeyboardType.Number,
            )
        }
        KlinaraDivider()
        KlinaraToggleRow(
            label = "Devredilebilir",
            detail = "Kalan hak başka bir müşteriye aktarılabilir",
            isOn = form.isTransferable,
            onToggle = { value -> viewModel.update { it.copy(isTransferable = value) } },
            enabled = canWrite,
        )
        KlinaraToggleRow(
            label = "Online satış",
            detail = "Rezervasyon sayfasında satışa açık",
            isOn = form.isOnlineSellable,
            onToggle = { value -> viewModel.update { it.copy(isOnlineSellable = value) } },
            enabled = canWrite,
        )
        KlinaraToggleRow(
            label = "Aktif",
            detail = "Pasif paket satılamaz; satılmış olanlar etkilenmez",
            isOn = form.isActive,
            onToggle = { value -> viewModel.update { it.copy(isActive = value) } },
            enabled = canWrite,
        )
    }
}

private const val MAX_QUANTITY = 100
private const val DEFAULT_VALIDITY_DAYS = 365
private const val MAX_DAY_DIGITS = 4
