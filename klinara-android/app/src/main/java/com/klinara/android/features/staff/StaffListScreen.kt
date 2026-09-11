package com.klinara.android.features.staff

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ColorDot
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
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
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val viewModel: StaffListViewModel = viewModel(key = "staff-list", factory = StaffListViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canCreate = canCreateStaff(session)

    LaunchedEffect(Unit) { viewModel.ensureLoaded() }

    KlinaraScreen(title = "Personel", modifier = modifier, onBack = onBack, trailing = trailing) {
        when (val profiles = state.profiles) {
            Loadable.Loading ->
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            is Loadable.Failed ->
                ErrorBanner(message = profiles.message, onRetry = if (profiles.isRetryable) viewModel::reload else null)
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
                        icon = Icons.Filled.Person,
                    )
                } else {
                    StaffBody(profiles = profiles.value, onOpen = onOpen)
                }
        }

        if (canCreate) {
            KlinaraButton(
                title = "Yeni personel",
                onClick = onCreate,
                kind = KlinaraButtonKind.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** Oluşturma giriş noktası iki izin ister — bkz. [StaffListScreen]. */
internal fun canCreateStaff(session: AppSession): Boolean =
    session.can(Permissions.STAFF_WRITE) && session.can(Permissions.USER_READ)

@Composable
private fun StaffBody(
    profiles: List<StaffProfile>,
    onOpen: (String) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var showsInactive by rememberSaveable { mutableStateOf(false) }

    KlinaraTextField(label = "Personel ara", value = query, onValueChange = { query = it })
    KlinaraToggleRow(label = "Pasifleri göster", isOn = showsInactive, onToggle = { showsInactive = it })

    val visible = filteredStaff(profiles, query, showsInactive)
    if (visible.isEmpty()) {
        Text("Aramanızla eşleşen personel yok.", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
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
