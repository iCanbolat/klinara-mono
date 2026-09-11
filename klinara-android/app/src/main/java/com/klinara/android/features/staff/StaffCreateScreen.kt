package com.klinara.android.features.staff

import androidx.compose.foundation.layout.Box
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
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSelectableRow
import com.klinara.android.designsystem.components.KlinaraTagField
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.staff.StaffProfile

/**
 * Yeni personel (A7.2) — iOS `StaffCreateView` paritesi.
 *
 * iOS'ta bir sheet; burada hedef. Oluşturunca **detaya** geçilir (iOS sheet'i kapatıp listeye
 * dönüyor): profilin bir sonraki adımı yetkinlik atamak ve o giriş noktası detayda.
 */
@Composable
fun StaffCreateScreen(
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    onCreated: (StaffProfile) -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: StaffCreateViewModel =
        viewModel(key = "staff-create", factory = StaffCreateViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.load() }
    LaunchedEffect(state.created) { state.created?.let(onCreated) }

    Box {
        KlinaraScreen(title = "Yeni personel", modifier = modifier, onBack = onBack) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }

            UserCard(state = state, viewModel = viewModel)

            if (state.form.userId != null) {
                ProfileCard(state = state, branches = session.branches, viewModel = viewModel)
                KlinaraButton(
                    title = "Oluştur",
                    onClick = viewModel::save,
                    enabled = state.form.isValid,
                    isLoading = state.isSaving,
                )
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }
}

@Composable
private fun UserCard(
    state: StaffCreateUiState,
    viewModel: StaffCreateViewModel,
) {
    val candidates = state.candidates
    val empty = (candidates as? Loadable.Loaded)?.value?.isEmpty() == true
    KlinaraCard(
        title = "Kullanıcı",
        footnote =
            if (empty) "Profili olmayan kullanıcı kalmadı. Yeni bir personel için önce davet gönderin." else null,
    ) {
        when (candidates) {
            Loadable.Loading ->
                Text("Kullanıcılar yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            is Loadable.Failed ->
                ErrorBanner(
                    message = candidates.message,
                    onRetry = if (candidates.isRetryable) viewModel::load else null,
                )
            is Loadable.Loaded ->
                if (candidates.value.isEmpty()) {
                    KlinaraRow(label = "Uygun kullanıcı yok")
                } else {
                    candidates.value.forEachIndexed { index, user ->
                        if (index > 0) KlinaraDivider()
                        KlinaraSelectableRow(
                            title = user.fullName,
                            detail = user.email,
                            isSelected = state.form.userId == user.id,
                            onClick = { viewModel.update { it.copy(userId = user.id) } },
                        )
                    }
                }
        }
    }
}

@Composable
private fun ProfileCard(
    state: StaffCreateUiState,
    branches: List<BranchSummary>,
    viewModel: StaffCreateViewModel,
) {
    val form = state.form
    KlinaraCard(title = "Profil", footnote = "Hizmet yetkinlikleri profil oluşturulduktan sonra atanır.") {
        KlinaraTextField(
            label = "Unvan",
            value = form.title,
            onValueChange = { value -> viewModel.update { it.copy(title = value) } },
            placeholder = "Lazer Uygulayıcısı",
            error = state.fieldErrors["title"],
        )
        KlinaraTagField(
            label = "Uzmanlıklar",
            tags = form.specialties,
            onTagsChange = { value -> viewModel.update { it.copy(specialties = value) } },
        )
        ColorSwatchPicker(
            selected = form.calendarColor,
            onSelect = { value -> viewModel.update { it.copy(calendarColor = value) } },
            label = "Takvim rengi",
        )
        PrimaryBranchPicker(
            selected = form.primaryBranchId,
            branches = branches,
            enabled = true,
            onSelect = { value -> viewModel.update { it.copy(primaryBranchId = value) } },
        )
        KlinaraToggleRow(
            label = "Online sayfada görünsün",
            detail = "Müşteriler bu personeli seçebilir",
            isOn = form.isVisibleOnline,
            onToggle = { value -> viewModel.update { it.copy(isVisibleOnline = value) } },
        )
    }
}

/** "Birincil şube" — `null` "Belirtilmedi" (iOS gibi); oluşturma ve detay paylaşıyor. */
@Composable
internal fun PrimaryBranchPicker(
    selected: String?,
    branches: List<BranchSummary>,
    enabled: Boolean,
    onSelect: (String?) -> Unit,
) {
    Text("BİRİNCİL ŞUBE", style = KlinaraType.label, color = KlinaraTheme.colors.charcoalMuted)
    KlinaraSelectableRow(
        title = "Belirtilmedi",
        isSelected = selected == null,
        onClick = { onSelect(null) },
        enabled = enabled,
    )
    // Oturumun erişemediği bir şube (başka şubenin yöneticisi atamış): gösterilmezse hiçbir
    // satır seçili görünmez ve kayıt "belirtilmemiş" gibi okunur.
    if (selected != null && branches.none { it.id == selected }) {
        KlinaraSelectableRow(title = "Erişiminiz olmayan bir şube", isSelected = true, onClick = {}, enabled = false)
    }
    branches.forEach { branch ->
        KlinaraSelectableRow(
            title = branch.name,
            isSelected = selected == branch.id,
            onClick = { onSelect(branch.id) },
            enabled = enabled,
        )
    }
}
