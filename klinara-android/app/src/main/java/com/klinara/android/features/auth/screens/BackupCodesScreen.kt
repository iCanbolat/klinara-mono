package com.klinara.android.features.auth.screens

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthScaffold
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.rememberClipboardCopy
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.features.auth.AuthEvent
import com.klinara.android.features.auth.AuthStep

/**
 * Yedek kodlar **bir kez** gösterilir; sunucu bir daha vermez.
 *
 * Bu yüzden ekranda geri tuşu yok ([com.klinara.android.features.auth.AuthBackHandler]
 * onu yutuyor) ve çıkış yalnız onay kutusundan geçiyor. Kullanıcının kodları
 * kaydetmeden ilerlemesi, hesabından kilitlenmesinin en kestirme yolu.
 */
@Composable
fun BackupCodesScreen(
    step: AuthStep.BackupCodesDisplay,
    onEvent: (AuthEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    var acknowledged by remember { mutableStateOf(false) }
    val copyToClipboard = rememberClipboardCopy()

    AuthScaffold(
        modifier = modifier,
        eyebrow = "Bir kez gösterilir",
        title = "Yedek kodlarınız",
        subtitle = "Telefonunuza erişemediğinizde bu kodlarla giriş yapabilirsiniz. Güvenli bir yere kaydedin.",
        actions = {
            KlinaraButton(
                title = "Devam et",
                onClick = { onEvent(AuthEvent.FinishBackupCodesDisplay) },
                enabled = acknowledged,
            )
        },
    ) {
        KlinaraCard {
            step.codes.chunked(CODES_PER_ROW).forEach { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
                ) {
                    row.forEach { code ->
                        Text(
                            code,
                            style = KlinaraType.bodyEmphasis,
                            color = KlinaraTheme.colors.charcoal,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }

        KlinaraButton(
            title = "Tümünü kopyala",
            onClick = { copyToClipboard("Klinara yedek kodları", step.codes.joinToString("\n")) },
            kind = KlinaraButtonKind.Secondary,
        )

        val interaction = remember { MutableInteractionSource() }
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .klinaraClickable(true, Role.Checkbox, interaction) { acknowledged = !acknowledged },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        ) {
            Icon(
                Icons.Filled.CheckCircle,
                contentDescription = if (acknowledged) "Onaylandı" else "Onaylanmadı",
                tint = if (acknowledged) KlinaraTheme.colors.sage else KlinaraTheme.colors.border,
                modifier = Modifier.then(Modifier).let { it },
            )
            Text(
                "Kodları kaydettim.",
                style = KlinaraType.bodyL,
                color = KlinaraTheme.colors.charcoal,
            )
        }
    }
}

private const val CODES_PER_ROW = 2

@KlinaraPreviews
@Composable
private fun BackupCodesScreenPreview() {
    KlinaraTheme {
        BackupCodesScreen(
            step = AuthStep.BackupCodesDisplay(listOf("4f2a-9c1e", "8b3d-2e7a", "1c9f-6d4b", "7e5a-3f8c")),
            onEvent = {},
        )
    }
}
