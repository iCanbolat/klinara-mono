package com.klinara.android.features.integrations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.integrations.WhatsAppAccount
import com.klinara.android.services.integrations.WhatsAppAccountUpsert
import com.klinara.android.services.integrations.WhatsAppService
import com.klinara.android.services.integrations.WhatsAppTemplate
import com.klinara.android.services.integrations.WhatsAppTestResult
import com.klinara.android.services.integrations.WhatsAppTestSend
import com.klinara.android.services.integrations.WhatsAppVerifyResult
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class WhatsAppUiState(
    /** `Loaded(null)` = **henüz kurulmadı** — bir hata DEĞİL, boş durum. */
    val account: Loadable<WhatsAppAccount?> = Loadable.Loading,
    val templates: Loadable<List<WhatsAppTemplate>> = Loadable.Loading,
    val isVerifying: Boolean = false,
    /** Son doğrulama — `ok: false` bir istek hatası değil, gösterilecek bir cevap. */
    val lastVerify: WhatsAppVerifyResult? = null,
    val error: String? = null,
) {
    val testableTemplates: List<WhatsAppTemplate>
        get() = templates.valueOrNull.orEmpty().filter { it.isTestable }
}

/**
 * WhatsApp entegrasyonu (A8.3) — iOS `WhatsAppStore` paritesi. Durum, editör, şablon listesi ve
 * test ekranı bu ViewModel'i PAYLAŞIR (sahibi ayar hedefinin geri yığını girdisi).
 */
class WhatsAppViewModel(
    private val service: WhatsAppService,
) : ViewModel() {
    private val _state = MutableStateFlow(WhatsAppUiState())
    val state: StateFlow<WhatsAppUiState> = _state.asStateFlow()

    /** Hesap, ardından (kuruluysa) şablonlar. */
    fun load() {
        viewModelScope.launch {
            val account = Loadable.of { service.account() }
            _state.update { it.copy(account = account) }
            if (account.valueOrNull != null) loadTemplatesNow()
        }
    }

    fun loadTemplates() {
        viewModelScope.launch { loadTemplatesNow() }
    }

    private suspend fun loadTemplatesNow() {
        val templates = Loadable.of { service.templates() }
        _state.update { it.copy(templates = templates) }
    }

    /** Doğrula → hesabı yeniden oku → başarılıysa şablonları tazele (senkron orada oldu). */
    fun verify() {
        if (_state.value.isVerifying) return
        _state.update { it.copy(isVerifying = true, error = null) }
        viewModelScope.launch {
            try {
                val result = service.verify()
                val account = service.account()
                _state.update { it.copy(lastVerify = result, account = Loadable.Loaded(account), isVerifying = false) }
                if (result.ok) loadTemplatesNow()
            } catch (error: ApiError) {
                _state.update { it.copy(isVerifying = false, error = error.displayMessage) }
            }
        }
    }

    /**
     * Editör kaydetti. Eski doğrulama sonucu **silinir**: yeni kimlik bilgileri henüz Meta'ya karşı
     * sınanmadı ve ekranda "Bağlantı doğrulandı" bırakmak yanlış bir güven verirdi.
     */
    fun accountSaved(account: WhatsAppAccount) =
        _state.update { it.copy(account = Loadable.Loaded(account), lastVerify = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    companion object {
        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    WhatsAppViewModel(container.whatsapp) as T
            }
    }
}

/**
 * Kimlik bilgisi taslağı — iOS `WhatsAppSettingsEditorView` kuralları, saf değer tipi.
 *
 * **Erişim token'ı her kayıtta yeniden girilir**: sunucu onu zorunlu tutuyor ve kayıtlı değer
 * okunamıyor. App secret boş bırakılırsa gönderilmez ve sunucu kayıtlısını korur ([S] A8.3).
 */
data class WhatsAppAccountDraft(
    val wabaId: String = "",
    val phoneNumberId: String = "",
    val businessPhone: String = "",
    val accessToken: String = "",
    val appSecret: String = "",
    val apiVersion: String = WhatsAppAccountUpsert.DEFAULT_API_VERSION,
    val existing: WhatsAppAccount? = null,
) {
    val isDirty: Boolean
        get() {
            val base = existing ?: return wabaId.isNotBlank() || phoneNumberId.isNotBlank() || accessToken.isNotBlank()
            return wabaId != base.wabaId ||
                phoneNumberId != base.phoneNumberId ||
                businessPhone != base.businessPhone.orEmpty() ||
                apiVersion != base.apiVersion ||
                accessToken.isNotEmpty() ||
                appSecret.isNotEmpty()
        }

    val tokenError: String?
        get() =
            "Token 10–500 karakter olmalı.".takeIf {
                accessToken.isNotEmpty() && accessToken.length !in WhatsAppAccountUpsert.ACCESS_TOKEN_LENGTH
            }

    val appSecretError: String?
        get() =
            "App secret 8–200 karakter olmalı.".takeIf {
                appSecret.isNotEmpty() && appSecret.length !in WhatsAppAccountUpsert.APP_SECRET_LENGTH
            }

    val apiVersionError: String?
        get() = "'v21.0' biçiminde olmalı.".takeUnless { WhatsAppAccountUpsert.API_VERSION.matches(apiVersion) }

    val isValid: Boolean
        get() =
            wabaId.trim().length >= WhatsAppAccountUpsert.MIN_ID_LENGTH &&
                phoneNumberId.trim().length >= WhatsAppAccountUpsert.MIN_ID_LENGTH &&
                accessToken.length in WhatsAppAccountUpsert.ACCESS_TOKEN_LENGTH &&
                appSecretError == null &&
                apiVersionError == null

    fun input(): WhatsAppAccountUpsert =
        WhatsAppAccountUpsert(
            wabaId = wabaId.trim(),
            phoneNumberId = phoneNumberId.trim(),
            businessPhone = businessPhone.trim().ifEmpty { null },
            accessToken = accessToken,
            appSecret = appSecret.ifEmpty { null },
            apiVersion = apiVersion.trim().ifEmpty { null },
        )

    companion object {
        fun from(existing: WhatsAppAccount?): WhatsAppAccountDraft =
            existing?.let {
                WhatsAppAccountDraft(
                    wabaId = it.wabaId,
                    phoneNumberId = it.phoneNumberId,
                    businessPhone = it.businessPhone.orEmpty(),
                    apiVersion = it.apiVersion,
                    existing = it,
                )
            } ?: WhatsAppAccountDraft()
    }
}

data class WhatsAppEditorUiState(
    val draft: WhatsAppAccountDraft,
    val isSaving: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val saved: WhatsAppAccount? = null,
)

class WhatsAppEditorViewModel(
    private val service: WhatsAppService,
    existing: WhatsAppAccount?,
) : ViewModel() {
    private val _state = MutableStateFlow(WhatsAppEditorUiState(WhatsAppAccountDraft.from(existing)))
    val state: StateFlow<WhatsAppEditorUiState> = _state.asStateFlow()

    fun update(transform: (WhatsAppAccountDraft) -> WhatsAppAccountDraft) =
        _state.update { it.copy(draft = transform(it.draft), error = null, fieldErrors = emptyMap()) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun save() {
        val current = _state.value
        if (current.isSaving || !current.draft.isValid) return
        _state.update { it.copy(isSaving = true, error = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                val saved = service.upsertAccount(current.draft.input())
                _state.update { it.copy(isSaving = false, saved = saved) }
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
            existing: WhatsAppAccount?,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    WhatsAppEditorViewModel(container.whatsapp, existing) as T
            }
    }
}

data class WhatsAppTestUiState(
    val phone: String = "",
    /** Seçili şablonun [WhatsAppTemplate.rowId]'si — ad + dil. */
    val selectedTemplate: String? = null,
    val isSending: Boolean = false,
    val result: WhatsAppTestResult? = null,
    val error: String? = null,
    val isRetryable: Boolean = false,
    val fieldErrors: Map<String, String> = emptyMap(),
)

/**
 * Test gönderimi (A8.3) — iOS `WhatsAppTestSheet`. Seçim **ad + dil** ile: iOS yalnız adı
 * tutuyordu ve aynı ad iki dilde varsa hep ilk dili gönderiyordu.
 */
class WhatsAppTestViewModel(
    private val service: WhatsAppService,
) : ViewModel() {
    private val _state = MutableStateFlow(WhatsAppTestUiState())
    val state: StateFlow<WhatsAppTestUiState> = _state.asStateFlow()

    fun setPhone(phone: String) = _state.update { it.copy(phone = phone, fieldErrors = emptyMap(), error = null) }

    fun select(template: WhatsAppTemplate) = _state.update { it.copy(selectedTemplate = template.rowId, error = null) }

    fun send(testable: List<WhatsAppTemplate>) {
        val current = _state.value
        val template = testable.firstOrNull { it.rowId == current.selectedTemplate } ?: return
        if (current.isSending || current.phone.isBlank()) return
        _state.update { it.copy(isSending = true, error = null, result = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                val result = service.sendTest(WhatsAppTestSend(current.phone, template.name, template.language))
                _state.update { it.copy(isSending = false, result = result) }
            } catch (error: ApiError) {
                _state.update {
                    it.copy(
                        isSending = false,
                        error = if (error.isFieldScoped) null else error.displayMessage,
                        // Yalnız kota (503) geçici: kalıcı hatada "tekrar dene" yanlış bir umut olurdu.
                        isRetryable = error.isRetryable,
                        fieldErrors = error.fieldErrors,
                    )
                }
            }
        }
    }

    companion object {
        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    WhatsAppTestViewModel(container.whatsapp) as T
            }
    }
}
