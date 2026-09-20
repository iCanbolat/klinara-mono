package com.klinara.android.features.customers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonSection
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.PhoneNumberField
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerGender
import com.klinara.android.services.crm.CustomerSource
import com.klinara.android.services.crm.CustomerTag
import com.klinara.android.services.networking.Loadable

/**
 * Müşteri oluşturma / düzenleme.
 *
 * Tek ekran iki mod: [customerId] null ise oluşturma. Ayırmak aynı formu iki kez
 * yazmak olurdu.
 */
@Composable
fun CustomerEditorScreen(
    container: ServiceContainer,
    customerId: String?,
    onBack: () -> Unit,
    onSaved: (Customer) -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: CustomerEditorViewModel =
        viewModel(
            key = "customer-editor-${customerId ?: "new"}",
            factory = CustomerEditorViewModel.factory(container, customerId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(customerId) { viewModel.load() }
    // Kaydedilen kaydı bir kez yukarı bildirir; ekran kendini kapatmaz, çağıran karar verir.
    LaunchedEffect(state.savedCustomer) { state.savedCustomer?.let(onSaved) }

    Box {
        KlinaraScreen(
            title = if (viewModel.isNew) "Yeni müşteri" else "Düzenle",
            modifier = modifier,
            onBack = onBack,
        ) {
            state.error?.let {
                ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError)
            }

            when (val loaded = state.loaded) {
                Loadable.Loading ->
                    KlinaraSkeleton(style = KlinaraSkeletonStyle.formLong)

                is Loadable.Failed ->
                    ErrorBanner(
                        message = loaded.message,
                        onRetry = if (loaded.isRetryable) viewModel::load else null,
                    )

                is Loadable.Loaded -> EditorBody(state = state, viewModel = viewModel)
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }
}

@Composable
private fun EditorBody(
    state: CustomerEditorUiState,
    viewModel: CustomerEditorViewModel,
) {
    val form = state.form

    KlinaraCard(title = "Kimlik") {
        KlinaraTextField(
            label = "Ad soyad",
            value = form.fullName,
            onValueChange = { value -> viewModel.update { it.copy(fullName = value) } },
            placeholder = "Ayşe Yılmaz",
            error = state.fieldErrors["fullName"],
        )
        KlinaraTextField(
            label = "Doğum tarihi",
            value = form.birthDate,
            onValueChange = { value -> viewModel.update { it.copy(birthDate = value) } },
            placeholder = "1990-05-12",
            // Sunucu çıplak tarih bekliyor; biçimi ekranda söylemek, kaydettikten
            // sonra 400 görmekten iyidir.
            error = state.fieldErrors["birthDate"] ?: form.birthDateError,
            keyboardType = KeyboardType.Number,
        )

        Text("CİNSİYET", style = KlinaraType.label, color = KlinaraTheme.colors.charcoalMuted)
        KlinaraSegmentedPicker(
            options = CustomerGender.selectable,
            selected = form.gender ?: CustomerGender.Undisclosed,
            onSelect = { value -> viewModel.update { it.copy(gender = value) } },
            title = { it.turkishName },
            modifier = Modifier.fillMaxWidth(),
        )
    }

    KlinaraCard(
        title = "İletişim",
        footnote = "Telefon numarası kiracı içinde tekildir; aynı numara iki kayıtta olamaz.",
    ) {
        PhoneNumberField(
            label = "Telefon",
            e164 = form.phoneE164,
            onE164Change = { value -> viewModel.update { it.copy(phoneE164 = value) } },
            error = state.fieldErrors["phone"],
        )
        KlinaraTextField(
            label = "E-posta",
            value = form.email,
            onValueChange = { value -> viewModel.update { it.copy(email = value) } },
            placeholder = "ayse@ornek.com",
            error = state.fieldErrors["email"] ?: form.emailError,
            keyboardType = KeyboardType.Email,
        )
    }

    KlinaraCard(title = "Adres") {
        KlinaraTextField(
            label = "Adres",
            value = form.addressLine,
            onValueChange = { value -> viewModel.update { it.copy(addressLine = value) } },
            error = state.fieldErrors["addressLine"],
        )
        KlinaraTextField(
            label = "İlçe",
            value = form.district,
            onValueChange = { value -> viewModel.update { it.copy(district = value) } },
            error = state.fieldErrors["district"],
        )
        KlinaraTextField(
            label = "İl",
            value = form.city,
            onValueChange = { value -> viewModel.update { it.copy(city = value) } },
            error = state.fieldErrors["city"],
        )
        KlinaraTextField(
            label = "Posta kodu",
            value = form.postalCode,
            onValueChange = { value -> viewModel.update { it.copy(postalCode = value) } },
            error = state.fieldErrors["postalCode"],
            keyboardType = KeyboardType.Number,
        )
    }

    KlinaraCard(title = "Geliş kaynağı") {
        SourceChips(
            selected = form.source,
            onSelect = { value -> viewModel.update { it.copy(source = value) } },
        )
    }

    TagPickerCard(state = state, viewModel = viewModel)

    KlinaraCard(title = "Not", footnote = "Bu alan klinik not değildir; herkes görebilir.") {
        KlinaraTextField(
            label = "Not",
            value = form.notes,
            onValueChange = { value -> viewModel.update { it.copy(notes = value) } },
            error = state.fieldErrors["notes"],
            imeAction = ImeAction.Done,
        )
    }

    KlinaraButton(
        title = "Kaydet",
        onClick = viewModel::save,
        enabled = form.isValid && (viewModel.isNew || form.isDirty || form.tagsChanged),
        isLoading = state.isSaving,
        modifier = Modifier.fillMaxWidth(),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SourceChips(
    selected: CustomerSource?,
    onSelect: (CustomerSource?) -> Unit,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        CustomerSource.selectable.forEach { source ->
            SelectableChip(
                label = source.turkishName,
                isSelected = selected == source,
                // Seçili olana tekrar dokunmak SEÇİMİ KALDIRIR: kaynağı yanlışlıkla
                // seçen birinin geri dönebileceği bir yol olmalı.
                onClick = { onSelect(if (selected == source) null else source) },
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TagPickerCard(
    state: CustomerEditorUiState,
    viewModel: CustomerEditorViewModel,
) {
    KlinaraCard(
        title = "Etiketler",
        footnote = "Etiketler Yönetim → Müşteri etiketleri altında tanımlanır.",
    ) {
        when (val tags = state.tags) {
            Loadable.Loading ->
                KlinaraSkeletonSection(hasDetail = false)

            is Loadable.Failed ->
                // Etiket gelmemesi formu düşürmez: ikinci dereceden bir bilgi için
                // kullanıcının adres yazmasını engellemek orantısız olurdu.
                Text(
                    "Etiketler yüklenemedi.",
                    style = KlinaraType.bodyM,
                    color = KlinaraTheme.colors.charcoalMuted,
                )

            is Loadable.Loaded ->
                if (tags.value.isEmpty()) {
                    Text(
                        "Henüz etiket tanımlanmamış.",
                        style = KlinaraType.bodyM,
                        color = KlinaraTheme.colors.charcoalMuted,
                    )
                } else {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
                        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
                    ) {
                        tags.value.forEach { tag: CustomerTag ->
                            SelectableChip(
                                label = tag.name,
                                isSelected = tag.id in state.form.tagIds,
                                onClick = { viewModel.update { form -> form.toggleTag(tag.id) } },
                                accent = parseHexColor(tag.color),
                            )
                        }
                    }
                }
        }
    }
}
