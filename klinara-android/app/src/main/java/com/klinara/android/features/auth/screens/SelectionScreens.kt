package com.klinara.android.features.auth.screens

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.components.AuthScaffold
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.features.auth.AuthStep
import com.klinara.android.features.auth.AuthUiState
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.auth.TenantOption
import com.klinara.android.services.contracts.RoleNames

/**
 * Kullanıcı birden çok klinikte üyeyse.
 *
 * Geri düğmesi YOK ama sistem geri tuşu `logout()` çağırır: bu noktada elimizde yalnız
 * `mfa` ara token'ı var ve tanımlayıcıya dönmek onu terk etmek demek. "Çıkış yap"
 * düğmesi bunu açıkça sunar.
 */
@Composable
fun TenantSelectScreen(
    step: AuthStep.TenantSelect,
    state: AuthUiState,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        modifier = modifier,
        title = "Klinik seçin",
        subtitle = "Birden çok klinikte kayıtlısınız.",
        actions = {
            KlinaraButton(
                title = "Çıkış yap",
                onClick = { onEvent(AuthEvent.Logout) },
                kind = KlinaraButtonKind.Tertiary,
            )
        },
    ) {
        state.error?.let { ErrorBanner(message = it.message, supportReference = it.supportReference) }

        KlinaraCard {
            step.options.forEach { tenant: TenantOption ->
                KlinaraNavigationRow(
                    label = tenant.name,
                    value = RoleNames.turkish(tenant.roles),
                    onClick = { onEvent(AuthEvent.SelectTenant(tenant)) },
                    enabled = !state.isBusy,
                )
            }
        }
    }
}

/**
 * Kullanıcı birden çok şubede görünürse.
 *
 * Bu adımda token ZATEN diskte; geri tuşu bu yüzden `logout()` çağırır (bkz.
 * [com.klinara.android.features.auth.AuthBackHandler] — iOS'ta canlı olan hatanın
 * düzeltmesi).
 */
@Composable
fun BranchSelectScreen(
    step: AuthStep.BranchSelect,
    state: AuthUiState,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        modifier = modifier,
        title = "Şube seçin",
        subtitle = "Seçtiğiniz şube tüm ekranların kapsamını belirler; sonra değiştirebilirsiniz.",
        actions = {
            KlinaraButton(
                title = "Çıkış yap",
                onClick = { onEvent(AuthEvent.Logout) },
                kind = KlinaraButtonKind.Tertiary,
            )
        },
    ) {
        state.error?.let { ErrorBanner(message = it.message, supportReference = it.supportReference) }

        KlinaraCard {
            step.branches.forEach { branch: BranchSummary ->
                KlinaraNavigationRow(
                    label = branch.name,
                    value = branch.address,
                    onClick = { onEvent(AuthEvent.SelectBranch(branch)) },
                    enabled = !state.isBusy,
                )
            }
        }
    }
}

@KlinaraPreviews
@Composable
private fun BranchSelectPreview() {
    KlinaraTheme {
        BranchSelectScreen(
            step =
                AuthStep.BranchSelect(
                    listOf(
                        BranchSummary("1", "Nişantaşı", address = "Teşvikiye Cad. No: 12"),
                        BranchSummary("2", "Bodrum", address = "Neyzen Tevfik Cad. No: 44"),
                    ),
                ),
            state = AuthUiState(),
            onEvent = {},
        )
    }
}
