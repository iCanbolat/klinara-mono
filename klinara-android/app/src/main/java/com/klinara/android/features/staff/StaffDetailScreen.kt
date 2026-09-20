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
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.KlinaraTagField
import com.klinara.android.designsystem.components.KlinaraTextEditor
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.staff.StaffProfile

/** Detaydan açılan alt hedefler — route'a çevirme `AppShell`'in işi. */
data class StaffDetailActions(
    val onOpenSkills: () -> Unit,
    /** Roller ve şubeler (A7.5) — `null` → satır çizilmez (`user:read` yok). */
    val onOpenMemberships: ((userId: String, userName: String) -> Unit)? = null,
    /** `null` → satır çizilmez (izin yok ya da henüz gelmedi). */
    val onOpenSchedule: (() -> Unit)? = null,
    val onOpenExceptions: (() -> Unit)? = null,
)

/**
 * Personel detayı (A7.2) — iOS `StaffDetailView` paritesi.
 *
 * `staff:write` yoksa alanlar pasif ve "Kaydet" çizilmez. **Silme yok**: pasife almak
 * "Aktif" anahtarı (sunucuda da öyle). Yetkinlikler satırı her zaman görünür — okuma izniyle
 * matris salt okunur açılır.
 */
@Composable
fun StaffDetailScreen(
    session: AppSession,
    container: ServiceContainer,
    staffId: String,
    onBack: () -> Unit,
    actions: StaffDetailActions,
    modifier: Modifier = Modifier,
) {
    val viewModel: StaffDetailViewModel =
        viewModel(key = "staff-detail-$staffId", factory = StaffDetailViewModel.factory(container, staffId))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canWrite = session.can(Permissions.STAFF_WRITE)

    // Matristen dönüşte de koşar: yetkinlik sayısı tazelenir, kirli taslak ezilmez.
    LaunchedEffect(Unit) { viewModel.load() }

    Box {
        KlinaraScreen(
            title = state.profile.valueOrNull?.userFullName ?: "Personel",
            modifier = modifier,
            onBack = onBack,
        ) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }

            when (val profile = state.profile) {
                Loadable.Loading ->
                    KlinaraSkeleton(style = KlinaraSkeletonStyle.formLong)
                is Loadable.Failed ->
                    ErrorBanner(message = profile.message, onRetry = if (profile.isRetryable) viewModel::load else null)
                is Loadable.Loaded -> {
                    KlinaraCard(title = "Hesap") {
                        KlinaraRow(label = "Ad soyad", value = profile.value.userFullName)
                        KlinaraRow(label = "E-posta", value = profile.value.userEmail.ifEmpty { "—" })
                    }
                    ProfileCard(state = state, session = session, canWrite = canWrite, viewModel = viewModel)
                    WorkCard(profile = profile.value, session = session, actions = actions)
                    if (state.didSave) {
                        Text(
                            "Değişiklikler kaydedildi.",
                            style = KlinaraType.bodyM,
                            color = KlinaraTheme.colors.sageDeep,
                        )
                    }
                    if (canWrite) {
                        KlinaraButton(
                            title = "Kaydet",
                            onClick = viewModel::save,
                            enabled = state.draft.isDirty,
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
private fun ProfileCard(
    state: StaffDetailUiState,
    session: AppSession,
    canWrite: Boolean,
    viewModel: StaffDetailViewModel,
) {
    val draft = state.draft
    KlinaraCard(title = "Profil") {
        KlinaraTextField(
            label = "Unvan",
            value = draft.title,
            onValueChange = { value -> viewModel.update { it.copy(title = value) } },
            placeholder = "Dermatolog",
            error = state.fieldErrors["title"],
            enabled = canWrite,
        )
        KlinaraTagField(
            label = "Uzmanlıklar",
            tags = draft.specialties,
            onTagsChange = { value -> viewModel.update { it.copy(specialties = value) } },
            enabled = canWrite,
        )
        KlinaraTextEditor(
            label = "Kısa tanıtım",
            value = draft.bio,
            onValueChange = { value -> viewModel.update { it.copy(bio = value) } },
            placeholder = "Online randevu sayfasında görünür",
            error = state.fieldErrors["bio"],
            enabled = canWrite,
        )
        ColorSwatchPicker(
            selected = draft.calendarColor,
            onSelect = { value -> if (canWrite) viewModel.update { it.copy(calendarColor = value) } },
            label = "Takvim rengi",
        )
        PrimaryBranchPicker(
            selected = draft.primaryBranchId,
            branches = session.branches,
            enabled = canWrite,
            onSelect = { value -> viewModel.update { it.copy(primaryBranchId = value) } },
        )
        KlinaraDivider()
        KlinaraToggleRow(
            label = "Online sayfada görünsün",
            detail = "Müşteriler bu personeli seçebilir",
            isOn = draft.isVisibleOnline,
            onToggle = { value -> viewModel.update { it.copy(isVisibleOnline = value) } },
            enabled = canWrite,
        )
        KlinaraToggleRow(
            label = "Aktif",
            detail = "Pasif personele randevu açılamaz",
            isOn = draft.isActive,
            onToggle = { value -> viewModel.update { it.copy(isActive = value) } },
            enabled = canWrite,
        )
    }
}

@Composable
private fun WorkCard(
    profile: StaffProfile,
    session: AppSession,
    actions: StaffDetailActions,
) {
    KlinaraCard(title = "Çalışma") {
        actions.onOpenMemberships?.let { open ->
            val ids = (profile.branchIds + listOfNotNull(profile.primaryBranchId)).toSet()
            val names = session.branches.filter { it.id in ids }.joinToString(", ") { it.name }
            KlinaraNavigationRow(
                label = "Roller ve şubeler",
                detail = names.ifEmpty { "Hangi şubede hangi rolle çalıştığı" },
                onClick = { open(profile.userId, profile.userFullName) },
            )
        }
        KlinaraNavigationRow(
            label = "Hizmet yetkinlikleri",
            value = "${profile.activeServiceCount}",
            detail = "Bu personelin yapabildiği hizmetler",
            onClick = actions.onOpenSkills,
        )
        actions.onOpenSchedule?.let { open ->
            KlinaraNavigationRow(
                label = "Haftalık çalışma programı",
                detail = session.activeBranch?.name ?: "Şube seçin",
                onClick = open,
            )
        }
        actions.onOpenExceptions?.let { open ->
            KlinaraNavigationRow(label = "İzin ve istisnalar", detail = "Bu personele ait kayıtlar", onClick = open)
        }
    }
}
