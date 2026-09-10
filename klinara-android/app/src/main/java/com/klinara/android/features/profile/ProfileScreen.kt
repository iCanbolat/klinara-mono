package com.klinara.android.features.profile

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.BuildConfig
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.PhoneNumber
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.PasskeySummary
import com.klinara.android.services.contracts.RoleNames
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import java.time.Instant

/**
 * Hesap ve oturum sekmesi.
 *
 * `AuthenticatedPlaceholderScreen`'in yerini alır: aynı bilgileri gösterir ama artık
 * akışın sonu değil, kabuğun bir sekmesidir.
 *
 * **iOS'ta olmayan üç bölüm** (TOTP durumu, passkey yönetimi, uygulama sürümü) kasıtlı
 * sapmadır: üçü de mevcut uçlarla karşılanıyor, yeni sunucu ucu eklenmedi. iOS'a
 * bildirilecek (§7.8).
 */
@Composable
fun ProfileScreen(
    session: AppSession,
    container: ServiceContainer,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
    onOpenDeveloperMenu: (() -> Unit)? = null,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val viewModel: ProfileViewModel =
        viewModel(
            key = "profile-${session.profile.user.id}",
            factory = ProfileViewModel.factory(container),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    var confirmingLogout by remember { mutableStateOf(false) }

    LaunchedEffect(session.profile.user.id) { viewModel.load() }

    KlinaraScreen(title = "Profil", modifier = modifier, trailing = trailing) {
        Greeting(session)
        SessionCard(session)
        SecurityCard(state = state, session = session, viewModel = viewModel)
        AppCard()
        if (onOpenDeveloperMenu != null) DeveloperCard(onOpenDeveloperMenu)

        KlinaraButton(
            title = "Çıkış yap",
            onClick = { confirmingLogout = true },
            kind = KlinaraButtonKind.Secondary,
        )
    }

    if (confirmingLogout) {
        LogoutDialog(
            onDismiss = { confirmingLogout = false },
            onConfirm = {
                confirmingLogout = false
                onEvent(AuthEvent.Logout)
            },
        )
    }
}

@Composable
private fun Greeting(session: AppSession) {
    val colors = KlinaraTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
        Text(
            KlinaraType.labelText("Hoş geldiniz"),
            style = KlinaraType.label,
            color = colors.sageDeep,
        )
        Text(session.profile.user.fullName, style = KlinaraType.displayM, color = colors.charcoal)
    }
}

@Composable
private fun SessionCard(session: AppSession) {
    val user = session.profile.user
    KlinaraCard(title = "Oturum") {
        KlinaraRow(label = "Şube", value = session.activeBranch?.name ?: "—")
        KlinaraDivider()
        KlinaraRow(label = "Rol", value = RoleNames.turkish(session.profile.roles))
        KlinaraDivider()
        KlinaraRow(label = "E-posta", value = user.email)
        KlinaraDivider()
        KlinaraRow(
            label = "Telefon",
            value = user.phone?.let(PhoneNumber::pretty) ?: "—",
            // Doğrulanmamış numara bir giriş tanımlayıcısı DEĞİLDİR; kullanıcı bunu
            // ancak burada görürse neden telefonla giremediğini anlar.
            detail = if (user.phone != null && !user.phoneVerified) "Doğrulanmadı" else null,
        )
    }
}

@Composable
private fun SecurityCard(
    state: ProfileUiState,
    session: AppSession,
    viewModel: ProfileViewModel,
) {
    KlinaraCard(title = "Güvenlik") {
        TotpRow(state.totp, viewModel::retryTotp)
        KlinaraDivider()
        PasskeySection(state = state, session = session, viewModel = viewModel)
    }
}

@Composable
private fun TotpRow(
    totp: Loadable<com.klinara.android.services.auth.TotpStatus>,
    onRetry: () -> Unit,
) {
    when (totp) {
        Loadable.Loading -> KlinaraRow(label = "İki adımlı doğrulama", value = "Yükleniyor…")
        is Loadable.Failed ->
            KlinaraRow(label = "İki adımlı doğrulama") {
                RetryLink(onRetry)
            }
        is Loadable.Loaded ->
            KlinaraRow(
                label = "İki adımlı doğrulama",
                value = if (totp.value.enabled) "Açık" else "Kapalı",
                detail =
                    if (totp.value.enabled) {
                        "${totp.value.backupCodesRemaining} yedek kod kaldı"
                    } else {
                        null
                    },
            ) {
                KlinaraBadge(
                    text = if (totp.value.enabled) "Korumalı" else "Korumasız",
                    tone = if (totp.value.enabled) KlinaraBadgeTone.Positive else KlinaraBadgeTone.Warning,
                )
            }
    }
}

@Composable
private fun PasskeySection(
    state: ProfileUiState,
    session: AppSession,
    viewModel: ProfileViewModel,
) {
    val colors = KlinaraTheme.colors
    Text(
        KlinaraType.labelText("Passkey"),
        style = KlinaraType.label,
        color = colors.charcoalMuted,
        modifier = Modifier.padding(top = KlinaraMetrics.xs),
    )

    when (val passkeys = state.passkeys) {
        Loadable.Loading -> KlinaraRow(label = "Yükleniyor…")
        is Loadable.Failed ->
            KlinaraRow(label = passkeys.message) {
                if (passkeys.isRetryable) RetryLink(viewModel::retryPasskeys)
            }
        is Loadable.Loaded ->
            if (passkeys.value.isEmpty()) {
                KlinaraRow(
                    label = "Kayıtlı passkey yok",
                    detail = "Parolayla giriş yapmaya devam edebilirsiniz.",
                )
            } else {
                val clock = remember(session.activeBranchId) { BranchClock(session.activeBranch?.timezone) }
                passkeys.value.forEachIndexed { index, passkey ->
                    if (index > 0) KlinaraDivider()
                    PasskeyRow(
                        passkey = passkey,
                        clock = clock,
                        isDeleting = state.deletingPasskeyId == passkey.id,
                        onDelete = { viewModel.deletePasskey(passkey.id) },
                    )
                }
            }
    }

    state.deleteError?.let { message ->
        ErrorBanner(
            message = message,
            retryLabel = "Kapat",
            onRetry = viewModel::dismissDeleteError,
            modifier = Modifier.padding(top = KlinaraMetrics.sm),
        )
    }
}

@Composable
private fun PasskeyRow(
    passkey: PasskeySummary,
    clock: BranchClock,
    isDeleting: Boolean,
    onDelete: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    var confirming by remember { mutableStateOf(false) }

    // `KlinaraRow` DEĞİL: o bir etiket/değer çiftidir ve etiketi soluk çizer. Burada
    // baskın olması gereken şey cihazın adı; "son kullanım" onun altındaki ayrıntı.
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = KlinaraMetrics.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(passkey.deviceLabel, style = KlinaraType.bodyL, color = colors.charcoal)
            Text(
                lastUsedText(passkey.lastUsedAt, clock),
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
            )
            if (passkey.backedUp) {
                Text("Buluta yedekleniyor", style = KlinaraType.bodyM, color = colors.charcoalMuted)
            }
        }

        if (isDeleting) {
            CircularProgressIndicator(
                color = colors.sageDeep,
                strokeWidth = SPINNER_STROKE,
                modifier = Modifier.size(SPINNER_SIZE),
            )
        } else {
            val interaction = remember { MutableInteractionSource() }
            Box(
                modifier =
                    Modifier
                        .size(KlinaraMetrics.minTouchTarget)
                        .klinaraClickable(true, Role.Button, interaction) { confirming = true }
                        .semantics { contentDescription = "${passkey.deviceLabel} passkey'ini sil" },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Delete,
                    contentDescription = null,
                    tint = colors.danger,
                    modifier = Modifier.size(ICON_SIZE),
                )
            }
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            containerColor = colors.surfaceRaised,
            icon = { Icon(Icons.Filled.Lock, contentDescription = null, tint = colors.charcoalMuted) },
            title = { Text("Passkey silinsin mi?", style = KlinaraType.titleM, color = colors.charcoal) },
            text = {
                Text(
                    "\"${passkey.deviceLabel}\" ile bir daha parolasız giriş yapamazsınız.",
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    onDelete()
                }) {
                    Text("Sil", style = KlinaraType.button, color = colors.danger)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirming = false }) {
                    Text("Vazgeç", style = KlinaraType.button, color = colors.charcoalMuted)
                }
            },
        )
    }
}

/**
 * Uygulama künyesi.
 *
 * Sürüm bir süs değil: bir kullanıcı "bende çalışmıyor" dediğinde ilk sorulan şey ve
 * onu Ayarlar'da aratmak destek çağrısını iki tura çıkarır.
 */
@Composable
private fun AppCard() {
    KlinaraCard(title = "Uygulama") {
        KlinaraRow(label = "Sürüm", value = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
        if (BuildConfig.DEBUG) {
            KlinaraDivider()
            // Yalnız debug: bir kullanıcının hangi sunucuya bağlı olduğunu bilmesi
            // gerekmez, bir geliştiricinin bilmesi gerekir.
            KlinaraRow(label = "Sunucu", value = BuildConfig.KLINARA_API_BASE_URL)
        }
    }
}

@Composable
private fun DeveloperCard(onOpen: () -> Unit) {
    KlinaraCard(
        title = "Geliştirici",
        footnote = "Yalnız debug derlemesinde; release APK'de bu kartın kodu bulunmaz.",
    ) {
        KlinaraNavigationRow(
            label = "Mock senaryoları",
            onClick = onOpen,
            detail = "Giriş yolu, veri seti ve canlı/mock geçişi",
        )
        KlinaraDivider()
        KlinaraRow(label = "Marka fontları", detail = KlinaraType.diagnostics)
    }
}

@Composable
private fun LogoutDialog(
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.surfaceRaised,
        title = { Text("Oturumu kapatmak istiyor musunuz?", style = KlinaraType.titleM, color = colors.charcoal) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text("Çıkış yap", style = KlinaraType.button, color = colors.danger)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Vazgeç", style = KlinaraType.button, color = colors.charcoalMuted)
            }
        },
    )
}

@Composable
private fun RowScope.RetryLink(onRetry: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier = Modifier.klinaraClickable(true, Role.Button, interaction, onRetry),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Tekrar dene", style = KlinaraType.bodyEmphasis, color = KlinaraTheme.colors.sageDeep)
    }
}

/**
 * `lastUsedAt` **şubenin** saat diliminde gösterilir, cihazınkinde değil (§5.8):
 * seyahat eden bir yönetici tarihleri kaymış görmemeli.
 */
private fun lastUsedText(
    raw: String?,
    clock: BranchClock,
): String {
    if (raw == null) return "Henüz kullanılmadı"
    val instant = runCatching { Instant.parse(raw) }.getOrNull() ?: return "Henüz kullanılmadı"
    return "Son kullanım: ${clock.formatDate(instant)}"
}

private val ICON_SIZE = 20.dp
private val SPINNER_SIZE = 20.dp
private val SPINNER_STROKE = 2.dp
