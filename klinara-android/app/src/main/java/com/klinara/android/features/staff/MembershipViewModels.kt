package com.klinara.android.features.staff

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.staff.CreateInvitationInput
import com.klinara.android.services.staff.Invitation
import com.klinara.android.services.staff.UsersService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class MembershipEditorUiState(
    /** null → henüz yüklenmedi. */
    val saved: List<MembershipRow>? = null,
    val rows: List<MembershipRow> = emptyList(),
    val loadError: String? = null,
    val error: String? = null,
    val isSaving: Boolean = false,
    val didSave: Boolean = false,
    val confirmsEmpty: Boolean = false,
    val isAdding: Boolean = false,
) {
    val isDirty: Boolean get() = saved != null && !MembershipRules.same(rows, saved)
    val issues: Map<String, MembershipIssue> get() = MembershipRules.issues(rows)
}

/**
 * Personelin rolleri ve şubeleri (A7.5) — iOS `MembershipEditorView` paritesi.
 *
 * `PUT users/:id/memberships` TAM değiştirme: kilitli satırlar olduğu gibi geri gönderilir,
 * boş liste ayrıca onaylanır. Hata YUTULMAZ; son sahip (409) ve rütbe (403) mesajı ekranda.
 */
class MembershipEditorViewModel(
    private val users: UsersService,
    private val userId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(MembershipEditorUiState())
    val state: StateFlow<MembershipEditorUiState> = _state.asStateFlow()

    private var counter = 0

    fun load() {
        if (_state.value.saved != null) return
        _state.update { it.copy(loadError = null) }
        viewModelScope.launch {
            try {
                val rows = MembershipRules.rows(users.memberships(userId))
                _state.update { it.copy(saved = rows, rows = rows) }
            } catch (error: ApiError) {
                _state.update { it.copy(loadError = error.displayMessage) }
            }
        }
    }

    fun remove(key: String) =
        _state.update { it.copy(rows = it.rows.filterNot { row -> row.key == key }, didSave = false) }

    fun startAdding() = _state.update { it.copy(isAdding = true) }

    fun cancelAdding() = _state.update { it.copy(isAdding = false) }

    fun add(
        roleKey: String,
        branchId: String?,
    ) {
        counter += 1
        val row =
            MembershipRow(
                key = "new-$counter",
                roleKey = roleKey,
                branchId = if (MembershipRules.isTenantScoped(roleKey)) null else branchId,
            )
        _state.update { it.copy(rows = it.rows + row, isAdding = false, didSave = false) }
    }

    fun discard() = _state.update { it.copy(rows = it.saved.orEmpty(), error = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun cancelEmpty() = _state.update { it.copy(confirmsEmpty = false) }

    fun save() {
        val current = _state.value
        if (!current.isDirty || current.issues.isNotEmpty() || current.isSaving) return
        if (current.rows.isEmpty()) _state.update { it.copy(confirmsEmpty = true) } else confirmSave()
    }

    fun confirmSave() {
        val rows = _state.value.rows
        _state.update { it.copy(confirmsEmpty = false, isSaving = true, error = null, didSave = false) }
        viewModelScope.launch {
            try {
                val saved = MembershipRules.rows(users.replaceMemberships(userId, MembershipRules.inputs(rows)))
                _state.update { it.copy(isSaving = false, saved = saved, rows = saved, didSave = true) }
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            userId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    MembershipEditorViewModel(container.users, userId) as T
            }
    }
}

data class InvitationListUiState(
    val invitations: List<Invitation>? = null,
    val loadError: String? = null,
    val pendingRevoke: Invitation? = null,
    val error: String? = null,
)

/**
 * Bekleyen davetler (A7.5) — kabul edilen ve iptal edilenler listelenmez; süresi dolan
 * rozetle kalır. İptal onaylıdır ve listeden hemen düşer.
 */
class InvitationListViewModel(
    private val users: UsersService,
) : ViewModel() {
    private val _state = MutableStateFlow(InvitationListUiState())
    val state: StateFlow<InvitationListUiState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            try {
                val pending = users.invitations().filter { it.isPending }.sortedByDescending { it.createdAt }
                _state.update { it.copy(invitations = pending, loadError = null) }
            } catch (error: ApiError) {
                _state.update { if (it.invitations == null) it.copy(loadError = error.displayMessage) else it }
            }
        }
    }

    fun askRevoke(invitation: Invitation) = _state.update { it.copy(pendingRevoke = invitation) }

    fun cancelRevoke() = _state.update { it.copy(pendingRevoke = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun confirmRevoke() {
        val target = _state.value.pendingRevoke ?: return
        _state.update { it.copy(pendingRevoke = null, error = null) }
        viewModelScope.launch {
            try {
                users.revokeInvitation(target.id)
                _state.update { state -> state.copy(invitations = state.invitations?.filterNot { it.id == target.id }) }
            } catch (error: ApiError) {
                _state.update { it.copy(error = error.displayMessage) }
            }
        }
    }

    companion object {
        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    InvitationListViewModel(container.users) as T
            }
    }
}

data class InviteDraft(
    val email: String = "",
    val fullName: String = "",
    val roleKey: String = "practitioner",
    val branchId: String? = null,
) {
    val tenantScoped: Boolean get() = MembershipRules.isTenantScoped(roleKey)
    val isValid: Boolean get() = email.contains('@') && (tenantScoped || branchId != null)
    val isDirty: Boolean get() = email.isNotBlank() || fullName.isNotBlank()

    fun input(): CreateInvitationInput =
        CreateInvitationInput(
            email = email.trim(),
            roleKey = roleKey,
            branchId = if (tenantScoped) null else branchId,
            fullName = fullName.trim().ifEmpty { null },
        )
}

data class InviteUiState(
    val draft: InviteDraft = InviteDraft(),
    val isSaving: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val sent: Invitation? = null,
)

/** Personel davet formu (A7.5) — iOS `InviteStaffView` paritesi. */
class InviteStaffViewModel(
    private val users: UsersService,
    initial: InviteDraft,
) : ViewModel() {
    private val _state = MutableStateFlow(InviteUiState(draft = initial))
    val state: StateFlow<InviteUiState> = _state.asStateFlow()

    fun update(transform: (InviteDraft) -> InviteDraft) =
        _state.update { it.copy(draft = transform(it.draft), error = null, fieldErrors = emptyMap()) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun send() {
        val draft = _state.value.draft
        if (!draft.isValid || _state.value.isSaving) return
        _state.update { it.copy(isSaving = true, error = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                val sent = users.invite(draft.input())
                _state.update { it.copy(isSaving = false, sent = sent) }
            } catch (error: ApiError) {
                _state.update {
                    it.copy(
                        isSaving = false,
                        error = if (error.isFieldScoped) null else error.displayMessage,
                        fieldErrors = error.fieldErrors,
                    )
                }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            initial: InviteDraft,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    InviteStaffViewModel(container.users, initial) as T
            }
    }
}
