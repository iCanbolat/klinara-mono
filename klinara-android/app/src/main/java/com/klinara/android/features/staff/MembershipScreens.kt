package com.klinara.android.features.staff

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
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
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSelectableRow
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToolbarAction
import com.klinara.android.designsystem.components.rememberUnsavedChangesGuard
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.contracts.RoleNames
import com.klinara.android.services.staff.Invitation
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal fun AppSession.membershipViewer(): MembershipViewer =
    MembershipViewer(
        userId = profile.user.id,
        roles = profile.roles,
        branchIds = profile.branchIds,
        tenantWide = profile.tenantWide,
    )

/** Erişebildiğim aktif şubeler — rol ve davette atanabilecek olanlar. */
internal fun AppSession.assignableBranches() =
    branches.filter { it.isActive && (profile.tenantWide || it.id in profile.branchIds) }

internal fun AppSession.branchLabel(branchId: String?): String =
    if (branchId == null) {
        "Kurum geneli"
    } else {
        branches.firstOrNull { it.id == branchId }?.name ?: "Erişiminiz olmayan bir şube"
    }

/**
 * Roller ve şubeler (A7.5) — iOS `MembershipEditorView` paritesi.
 *
 * `user:read` ile açılır; düzenleme `user:write` VEYA `user:invite` ister ve [EditorLock]
 * yoksa mümkündür. Rütbe kilitli satır görünür ve olduğu gibi geri gönderilir.
 */
@Composable
fun MembershipEditorScreen(
    session: AppSession,
    container: ServiceContainer,
    userId: String,
    userName: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: MembershipEditorViewModel =
        viewModel(key = "memberships-$userId", factory = MembershipEditorViewModel.factory(container, userId))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val viewer = session.membershipViewer()
    val canWrite = session.canAny(Permissions.USER_WRITE, Permissions.USER_INVITE)
    val lock = state.saved?.let { MembershipRules.editorLock(userId, it, viewer) }
    val editable = canWrite && lock == null
    val back = rememberUnsavedChangesGuard(isDirty = state.isDirty, onLeave = onBack)

    LaunchedEffect(Unit) { viewModel.load() }

    Box {
        KlinaraScreen(title = "Roller ve şubeler", modifier = modifier, onBack = back) {
            state.loadError?.let { ErrorBanner(message = it, onRetry = viewModel::load) }
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }
            if (state.saved == null) {
                if (state.loadError == null) {
                    KlinaraSkeleton(style = KlinaraSkeletonStyle.formShort)
                }
                return@KlinaraScreen
            }

            membershipNotice(lock, canWrite)?.let {
                Text(it, style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            }
            if (state.didSave) {
                Text(
                    "Roller kaydedildi. Değişiklik hemen geçerli.",
                    style = KlinaraType.bodyM,
                    color = KlinaraTheme.colors.sageDeep,
                )
            }

            MembershipCard(
                session = session,
                userName = userName,
                state = state,
                viewer = viewer,
                onRemove = if (editable) viewModel::remove else null,
            )

            if (editable) MembershipActions(state = state, viewModel = viewModel)
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }

    if (state.isAdding) {
        AddMembershipDialog(
            session = session,
            viewer = viewer,
            onAdd = viewModel::add,
            onDismiss = viewModel::cancelAdding,
        )
    }

    if (state.confirmsEmpty) {
        AlertDialog(
            onDismissRequest = viewModel::cancelEmpty,
            title = { Text("Tüm roller kaldırılsın mı?", style = KlinaraType.titleM) },
            text = { Text("$userName kliniğe erişimini tamamen kaybeder.", style = KlinaraType.bodyM) },
            confirmButton = { TextButton(onClick = viewModel::confirmSave) { Text("Rolleri kaldır") } },
            dismissButton = { TextButton(onClick = viewModel::cancelEmpty) { Text("Vazgeç") } },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        )
    }
}

@Composable
private fun MembershipCard(
    session: AppSession,
    userName: String,
    state: MembershipEditorUiState,
    viewer: MembershipViewer,
    onRemove: ((String) -> Unit)?,
) {
    KlinaraCard(title = userName, footnote = "Liste kaydedildiğinde tamamen değiştirilir.") {
        if (state.rows.isEmpty()) KlinaraRow(label = "Klinikte rolü yok")
        state.rows.forEachIndexed { index, row ->
            if (index > 0) KlinaraDivider()
            MembershipRowView(
                session = session,
                row = row,
                lock = MembershipRules.lock(row, viewer),
                issue = state.issues[row.key],
                onRemove = onRemove?.let { remove -> { remove(row.key) } },
            )
        }
    }
}

private fun membershipNotice(
    lock: EditorLock?,
    canWrite: Boolean,
): String? =
    when (lock) {
        EditorLock.Self -> "Kendi rollerinizi değiştiremezsiniz; bunu sizden yetkili biri yapmalı."
        EditorLock.Branch ->
            "Bu kişinin erişiminiz olmayan bir şubede de rolü var. Rolleri, tüm şubelerine erişimi " +
                "olan biri düzenleyebilir."
        null -> if (canWrite) null else "Rolleri görüntüleyebilirsiniz ama değiştiremezsiniz."
    }

@Composable
private fun MembershipActions(
    state: MembershipEditorUiState,
    viewModel: MembershipEditorViewModel,
) {
    KlinaraButton(
        title = "Rol ekle",
        onClick = viewModel::startAdding,
        kind = KlinaraButtonKind.Secondary,
        modifier = Modifier.fillMaxWidth(),
    )
    if (state.isDirty) {
        KlinaraButton(
            title = "Değişiklikleri geri al",
            onClick = viewModel::discard,
            kind = KlinaraButtonKind.Tertiary,
            modifier = Modifier.fillMaxWidth(),
        )
    }
    KlinaraButton(
        title = "Rolleri kaydet",
        onClick = viewModel::save,
        enabled = state.isDirty && state.issues.isEmpty(),
        isLoading = state.isSaving,
    )
}

@Composable
private fun MembershipRowView(
    session: AppSession,
    row: MembershipRow,
    lock: MembershipLock?,
    issue: MembershipIssue?,
    onRemove: (() -> Unit)?,
) {
    val colors = KlinaraTheme.colors
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(RoleNames.turkish(row.roleKey), style = KlinaraType.bodyEmphasis, color = colors.charcoal)
            Text(session.branchLabel(row.branchId), style = KlinaraType.bodyM, color = colors.charcoalMuted)
            if (issue == MembershipIssue.Duplicate) {
                Text("Bu rol bu şubede zaten var.", style = KlinaraType.bodyM, color = colors.danger)
            }
            if (lock == MembershipLock.Rank) {
                Text(
                    "Sizden yetkili bir rol — değiştirilemez.",
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                )
            }
        }
        when {
            lock != null ->
                Icon(
                    Icons.Filled.Lock,
                    contentDescription =
                        if (lock == MembershipLock.Rank) "Sizden yetkili rol" else "Erişiminiz olmayan şube",
                    tint = colors.charcoalMuted,
                    modifier = Modifier.size(20.dp),
                )
            onRemove != null ->
                IconButton(onClick = onRemove) {
                    Icon(
                        Icons.Filled.Delete,
                        contentDescription = "Rolü kaldır: ${RoleNames.turkish(row.roleKey)}",
                        tint = colors.danger,
                    )
                }
        }
    }
}

@Composable
private fun AddMembershipDialog(
    session: AppSession,
    viewer: MembershipViewer,
    onAdd: (roleKey: String, branchId: String?) -> Unit,
    onDismiss: () -> Unit,
) {
    val roles = MembershipRules.assignableRoles(viewer.roles)
    val branches = session.assignableBranches()
    var roleKey by rememberSaveable { mutableStateOf(roles.lastOrNull()?.key.orEmpty()) }
    var branchId by rememberSaveable {
        mutableStateOf(branches.firstOrNull { it.id == session.activeBranchId }?.id ?: branches.firstOrNull()?.id)
    }
    val tenantScoped = MembershipRules.isTenantScoped(roleKey)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Rol ekle", style = KlinaraType.titleM) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
                Text("ROL", style = KlinaraType.label, color = KlinaraTheme.colors.charcoalMuted)
                roles.forEach { role ->
                    KlinaraSelectableRow(
                        title = RoleNames.turkish(role.key),
                        isSelected = roleKey == role.key,
                        onClick = { roleKey = role.key },
                    )
                }
                Text("ŞUBE", style = KlinaraType.label, color = KlinaraTheme.colors.charcoalMuted)
                if (tenantScoped) {
                    Text(
                        "Kurum geneli — tüm şubelerde geçerli",
                        style = KlinaraType.bodyM,
                        color = KlinaraTheme.colors.charcoalMuted,
                    )
                } else {
                    branches.forEach { branch ->
                        KlinaraSelectableRow(
                            title = branch.name,
                            isSelected = branchId == branch.id,
                            onClick = { branchId = branch.id },
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onAdd(roleKey, branchId) },
                enabled = roleKey.isNotEmpty() && (tenantScoped || branchId != null),
            ) {
                Text("Ekle")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Vazgeç") } },
        containerColor = KlinaraTheme.colors.surfaceRaised,
    )
}

/**
 * Bekleyen davetler (A7.5) — iOS `InvitationListView` paritesi. `user:invite` ile açılır.
 */
@Composable
fun InvitationListScreen(
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    onInvite: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: InvitationListViewModel =
        viewModel(key = "invitations", factory = InvitationListViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val now = Instant.now()

    // Davet formundan dönüşte de koşar: yeni davet listede görünsün.
    LaunchedEffect(Unit) { viewModel.load() }

    KlinaraScreen(
        title = "Davetler",
        modifier = modifier,
        onBack = onBack,
        trailing = { KlinaraToolbarAction(contentDescription = "Personel davet et", onClick = onInvite) },
    ) {
        state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }
        val invitations = state.invitations
        when {
            invitations == null && state.loadError != null ->
                ErrorBanner(message = state.loadError!!, onRetry = viewModel::load)
            invitations == null ->
                KlinaraSkeleton(style = KlinaraSkeletonStyle.cardsShort)
            invitations.isEmpty() ->
                EmptyStateView(
                    title = "Bekleyen davet yok",
                    message = "Davet edilen kişi e-postadaki bağlantıyla parolasını belirleyip katılır.",
                    icon = Icons.Filled.Email,
                    actionTitle = "Personel davet et",
                    onAction = onInvite,
                )
            else ->
                KlinaraCard(footnote = "İptal edilen davetin bağlantısı hemen geçersiz olur.") {
                    invitations.forEachIndexed { index, invitation ->
                        if (index > 0) KlinaraDivider()
                        InvitationRow(session, invitation, now, onRevoke = { viewModel.askRevoke(invitation) })
                    }
                }
        }
    }

    state.pendingRevoke?.let { invitation ->
        AlertDialog(
            onDismissRequest = viewModel::cancelRevoke,
            title = { Text("Davet iptal edilsin mi?", style = KlinaraType.titleM) },
            text = {
                Text("${invitation.email} adresine gönderilen bağlantı geçersiz olur.", style = KlinaraType.bodyM)
            },
            confirmButton = { TextButton(onClick = viewModel::confirmRevoke) { Text("Daveti iptal et") } },
            dismissButton = { TextButton(onClick = viewModel::cancelRevoke) { Text("Vazgeç") } },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        )
    }
}

private val EXPIRY_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM", Locale.forLanguageTag("tr"))

@Composable
private fun InvitationRow(
    session: AppSession,
    invitation: Invitation,
    now: Instant,
    onRevoke: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(invitation.email, style = KlinaraType.bodyEmphasis, color = colors.charcoal, maxLines = 1)
            Text(
                "${RoleNames.turkish(invitation.roleKey)} · ${session.branchLabel(invitation.branchId)}",
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
            )
            if (invitation.isExpired(now)) {
                KlinaraBadge("Süresi doldu", tone = KlinaraBadgeTone.Warning)
            } else {
                val zone = ZoneId.of(session.activeBranch?.timezone ?: "Europe/Istanbul")
                KlinaraBadge(
                    "Son gün ${EXPIRY_FORMAT.format(invitation.expiresAt.atZone(zone))}",
                    tone = KlinaraBadgeTone.Muted,
                )
            }
        }
        TextButton(onClick = onRevoke) { Text("İptal et", color = colors.danger) }
    }
}

/** Personel davet formu (A7.5) — iOS `InviteStaffView` paritesi; "Gönder" sayfanın altında. */
@Composable
fun InviteStaffScreen(
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    onSent: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val roles = MembershipRules.assignableRoles(session.profile.roles)
    val branches = session.assignableBranches()
    val initial =
        InviteDraft(
            roleKey = roles.firstOrNull { it.key == "practitioner" }?.key ?: roles.lastOrNull()?.key.orEmpty(),
            branchId = branches.firstOrNull { it.id == session.activeBranchId }?.id ?: branches.firstOrNull()?.id,
        )
    val viewModel: InviteStaffViewModel =
        viewModel(key = "invite-staff", factory = InviteStaffViewModel.factory(container, initial))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val draft = state.draft
    val back = rememberUnsavedChangesGuard(isDirty = draft.isDirty && state.sent == null, onLeave = onBack)

    LaunchedEffect(state.sent) { if (state.sent != null) onSent() }

    Box {
        KlinaraScreen(title = "Personel davet et", modifier = modifier, onBack = back) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }

            KlinaraCard(
                title = "Kişi",
                footnote = "Davet edilen kişi e-postadaki bağlantıyla parolasını belirleyip katılır.",
            ) {
                KlinaraTextField(
                    label = "E-posta",
                    value = draft.email,
                    onValueChange = { value -> viewModel.update { it.copy(email = value) } },
                    placeholder = "ad@klinik.com",
                    error = state.fieldErrors["email"],
                    keyboardType = KeyboardType.Email,
                )
                KlinaraTextField(
                    label = "Ad soyad",
                    value = draft.fullName,
                    onValueChange = { value -> viewModel.update { it.copy(fullName = value) } },
                    placeholder = "İsteğe bağlı",
                    error = state.fieldErrors["fullName"],
                )
            }

            KlinaraCard(title = "Rol") {
                roles.forEach { role ->
                    KlinaraSelectableRow(
                        title = RoleNames.turkish(role.key),
                        isSelected = draft.roleKey == role.key,
                        onClick = { viewModel.update { it.copy(roleKey = role.key) } },
                    )
                }
            }

            KlinaraCard(title = "Şube") {
                if (draft.tenantScoped) {
                    KlinaraRow(label = "Kurum geneli", detail = "Bu rol tüm şubelerde geçerli")
                } else {
                    branches.forEach { branch ->
                        KlinaraSelectableRow(
                            title = branch.name,
                            isSelected = draft.branchId == branch.id,
                            onClick = { viewModel.update { it.copy(branchId = branch.id) } },
                        )
                    }
                }
            }

            KlinaraButton(
                title = "Gönder",
                onClick = viewModel::send,
                enabled = draft.isValid,
                isLoading = state.isSaving,
            )
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Gönderiliyor…")
    }
}
