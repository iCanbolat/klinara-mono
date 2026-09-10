package com.klinara.android.features.auth.screens

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.components.AuthScaffold
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.services.contracts.RoleNames

/**
 * Oturum açıldıktan sonraki geçici ekran.
 *
 * **A2.1'de `AppShell` (alt gezinme, sekmeler) bunun yerine geçecek.** Şimdilik M1
 * kilometre taşının doğrulanabilir olması için var: hangi kullanıcı, hangi kiracı,
 * hangi şube kapsamı ve kaç izin geldi — hepsi tek ekranda.
 */
@Composable
fun AuthenticatedPlaceholderScreen(
    session: AppSession,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        modifier = modifier,
        eyebrow = "Oturum açık",
        title = session.profile.user.fullName,
        subtitle = "Kabuk ve sekmeler A2.1'de gelecek.",
        actions = {
            KlinaraButton(
                title = "Çıkış yap",
                onClick = { onEvent(AuthEvent.Logout) },
                kind = KlinaraButtonKind.Secondary,
            )
        },
    ) {
        KlinaraCard(title = "Kimlik") {
            KlinaraRow(label = "E-posta", value = session.profile.user.email)
            KlinaraRow(label = "Rol", value = RoleNames.turkish(session.profile.roles))
            KlinaraRow(label = "Kiracı", value = session.profile.tenantId)
        }

        KlinaraCard(title = "Kapsam", footnote = "İzinler sunucunun kararıdır; istemci yalnız yansıtır.") {
            KlinaraRow(
                label = "Aktif şube",
                value = session.activeBranch?.name ?: "Seçilmedi",
                detail = session.activeBranch?.timezone,
            )
            KlinaraRow(label = "Görünür şube", value = "${session.branches.size}")
            KlinaraRow(label = "İzin", value = "${session.profile.permissions.size}")
        }
    }
}
