package com.klinara.android.features.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ColorDot
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.FabContentClearance
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraCheckMenuItem
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraFabAction
import com.klinara.android.designsystem.components.KlinaraFabMenu
import com.klinara.android.designsystem.components.KlinaraIcons
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraOverflowMenu
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSearchField
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.calendar.accentColor
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.staff.StaffProfile

/**
 * Personel (A7.2) — iOS `StaffListView` paritesi.
 *
 * `staff:read` görür. "Yeni personel" `staff:write` **ve** `user:read` ister: oluşturma
 * ekranı aday kullanıcıları `GET users`'tan çekiyor; yalnız birine sahip bir rol düğmeyi
 * görüp içeride 403 alırdı (§5.7). Bugün iki izin aynı rollerde ama koşul şans eseri doğru
 * olmamalı.
 */
@Composable
fun StaffListScreen(
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    onOpen: (staffId: String) -> Unit,
    onCreate: () -> Unit,
    modifier: Modifier = Modifier,
    onInvite: (() -> Unit)? = null,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val viewModel: StaffListViewModel = viewModel(key = "staff-list", factory = StaffListViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canCreate = canCreateStaff(session)

    LaunchedEffect(Unit) { viewModel.ensureLoaded() }

    var showsInactive by rememberSaveable { mutableStateOf(false) }
    // null → oturumun seçili şubesi; "" → tüm şubeler (yalnız kiracı geneli rollerde).
    var branchFilter by rememberSaveable { mutableStateOf<String?>(null) }
    val effectiveBranch = (branchFilter ?: session.activeBranchId).takeUnless { it.isNullOrEmpty() }

    val actions =
        buildList {
            if (onInvite != null && session.can(Permissions.USER_INVITE)) {
                add(KlinaraFabAction("Personel davet et", Icons.Filled.Email, onInvite))
            }
            if (canCreate) add(KlinaraFabAction("Yeni personel", Icons.Filled.Person, onCreate))
        }

    Box(modifier = modifier.fillMaxSize()) {
        KlinaraScreen(
            title = "Personel",
            onBack = onBack,
            verticalSpacing = KlinaraMetrics.md,
            trailing = {
                trailing?.invoke(this)
                StaffBranchFilterMenu(
                    session = session,
                    effectiveBranch = effectiveBranch,
                    onSelect = { branchFilter = it },
                )
                KlinaraOverflowMenu { dismiss ->
                    KlinaraCheckMenuItem(label = "Pasifleri göster", isChecked = showsInactive, onToggle = {
                        showsInactive = it
                        dismiss()
                    })
                }
            },
        ) {
            when (val profiles = state.profiles) {
                Loadable.Loading ->
                    KlinaraSkeleton(style = KlinaraSkeletonStyle.cardsLong)
                is Loadable.Failed ->
                    ErrorBanner(
                        message = profiles.message,
                        onRetry = if (profiles.isRetryable) viewModel::reload else null,
                    )
                is Loadable.Loaded ->
                    if (profiles.value.isEmpty()) {
                        EmptyStateView(
                            title = "Personel yok",
                            message =
                                if (canCreate) {
                                    "Personel profili mevcut bir kullanıcıya bağlanır. Önce kullanıcıyı davet edin, " +
                                        "sonra buradan profilini oluşturun."
                                } else {
                                    "Personel eklemek için yöneticinizle görüşün."
                                },
                            iconRes = KlinaraIcons.staff,
                            // Personel profili mevcut bir kullanıcıya bağlanır: boş listede
                            // yapılacak ilk iş davet etmek, profil açmak değil.
                            actionTitle = actions.firstOrNull()?.label,
                            actionIcon = actions.firstOrNull()?.icon,
                            onAction = actions.firstOrNull()?.onClick,
                        )
                    } else {
                        StaffBody(
                            profiles = profiles.value,
                            showsInactive = showsInactive,
                            effectiveBranch = effectiveBranch,
                            onOpen = onOpen,
                        )
                    }
            }

            if (actions.isNotEmpty()) Spacer(Modifier.height(FabContentClearance))
        }

        KlinaraFabMenu(actions = actions, contentDescription = "Personel ekle")
    }
}

/**
 * Personel listesinin şube filtresi — iOS `branchFilterBar` paritesi, üst çubukta bir seçici.
 *
 * Oturumun şubesini DEĞİŞTİRMEZ; yalnız bu listeyi daraltır. "Tüm şubeler" yalnız kiracı
 * geneli rollerde var: şubeye bağlı bir rol başka şubenin personelini zaten göremez.
 */
@Composable
private fun StaffBranchFilterMenu(
    session: AppSession,
    effectiveBranch: String?,
    onSelect: (String) -> Unit,
) {
    val colors = KlinaraTheme.colors
    var expanded by remember { mutableStateOf(false) }
    val branches = session.switchableBranches
    val current = branches.firstOrNull { it.id == effectiveBranch }?.name ?: "Tüm şubeler"
    val interaction = remember { MutableInteractionSource() }

    Box {
        Box(
            modifier =
                Modifier
                    .klinaraClickable(true, Role.Button, interaction) { expanded = true }
                    .semantics { contentDescription = "Şube filtresi: $current" },
            contentAlignment = Alignment.Center,
        ) {
            Row(
                modifier =
                    Modifier
                        .heightIn(min = 36.dp)
                        .background(colors.sageSoft, CircleShape)
                        .padding(horizontal = KlinaraMetrics.sm + KlinaraMetrics.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
            ) {
                Icon(
                    Icons.Filled.Place,
                    contentDescription = null,
                    tint = colors.sageDeep,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    current,
                    style = KlinaraType.bodyEmphasis,
                    color = colors.sageDeep,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 130.dp),
                )
                Icon(
                    Icons.Filled.KeyboardArrowDown,
                    contentDescription = null,
                    tint = colors.sageDeep,
                    modifier = Modifier.size(18.dp),
                )
            }
        }

        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            containerColor = colors.surfaceRaised,
        ) {
            val options =
                buildList {
                    if (session.profile.tenantWide) add("" to "Tüm şubeler")
                    branches.forEach { add(it.id to it.name) }
                }
            options.forEach { (id, name) ->
                val isSelected = (effectiveBranch ?: "") == id
                DropdownMenuItem(
                    text = { Text(name, style = KlinaraType.bodyL, color = colors.charcoal) },
                    onClick = {
                        expanded = false
                        onSelect(id)
                    },
                    trailingIcon =
                        if (isSelected) {
                            {
                                Icon(
                                    Icons.Filled.Check,
                                    contentDescription = "Seçili",
                                    tint = colors.sageDeep,
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        } else {
                            null
                        },
                )
            }
        }
    }
}

/** Oluşturma giriş noktası iki izin ister — bkz. [StaffListScreen]. */
internal fun canCreateStaff(session: AppSession): Boolean =
    session.can(Permissions.STAFF_WRITE) && session.can(Permissions.USER_READ)

@Composable
private fun StaffBody(
    profiles: List<StaffProfile>,
    showsInactive: Boolean,
    effectiveBranch: String?,
    onOpen: (String) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }

    KlinaraSearchField(value = query, onValueChange = { query = it }, placeholder = "Personel ara")

    val visible = filteredStaff(profiles, query, showsInactive, effectiveBranch)
    if (visible.isEmpty()) {
        Text(
            if (query.isBlank()) {
                "Bu şubede personel yok. Rol ve şube atamasını personelin detayından yapabilirsiniz."
            } else {
                "Aramanızla eşleşen personel yok."
            },
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.charcoalMuted,
        )
        return
    }
    KlinaraCard {
        visible.forEachIndexed { index, profile ->
            if (index > 0) KlinaraDivider()
            StaffRow(profile = profile, onClick = { onOpen(profile.id) })
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StaffRow(
    profile: StaffProfile,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val count = profile.activeServiceCount
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
        KlinaraNavigationRow(label = profile.userFullName, detail = profile.title, onClick = onClick)
        Row(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ColorDot(color = accentColor(profile.calendarColor, colors.border))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
                verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
            ) {
                // Sıfır yetkinlik uyarı tonunda: bu personele HİÇ randevu açılamaz.
                KlinaraBadge(
                    "$count hizmet",
                    tone = if (count == 0) KlinaraBadgeTone.Warning else KlinaraBadgeTone.Neutral,
                )
                if (!profile.isActive) KlinaraBadge("Pasif", tone = KlinaraBadgeTone.Muted)
                if (profile.isVisibleOnline) KlinaraBadge("Online", tone = KlinaraBadgeTone.Positive)
            }
        }
    }
}
