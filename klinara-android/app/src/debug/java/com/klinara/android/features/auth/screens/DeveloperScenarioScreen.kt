package com.klinara.android.features.auth.screens

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthScaffold
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.services.mock.MockDataScenario
import com.klinara.android.services.mock.MockScenario

/**
 * Geliştirici senaryo menüsü — **yalnız debug varyantında derlenir**, release APK'de
 * kodu bile bulunmaz (§5.9).
 *
 * Giriş ekranından erişilebilir olması bilinçli: `WrongPassword` ve `AccountLocked`
 * senaryoları kullanıcıyı başka türlü çıkışsız bırakır.
 */
@Composable
fun DeveloperScenarioScreen(
    activeScenario: MockScenario?,
    activeData: MockDataScenario?,
    isMock: Boolean,
    onSelect: (MockScenario, MockDataScenario) -> Unit,
    onUseLive: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        modifier = modifier,
        eyebrow = "Yalnız debug",
        title = "Senaryolar",
        subtitle = "Sunucu ayakta olmadan tüm giriş dallarını sür.",
        onBack = onClose,
        actions = {
            KlinaraButton(title = "Kapat", onClick = onClose, kind = KlinaraButtonKind.Tertiary)
        },
    ) {
        KlinaraCard(title = "Kaynak") {
            Text(
                if (isMock) "Mock grafiği kullanılıyor." else "Canlı sunucuya bağlanılıyor.",
                style = KlinaraType.bodyM,
                color = KlinaraTheme.colors.charcoalMuted,
            )
            KlinaraButton(
                title = "Canlı sunucuya dön",
                onClick = onUseLive,
                kind = KlinaraButtonKind.Secondary,
                enabled = isMock,
            )
        }

        KlinaraCard(title = "Giriş yolu") {
            MockScenario.entries.forEach { scenario ->
                ScenarioRow(
                    label = scenario.turkishName,
                    detail = scenario.roleKey,
                    selected = scenario == activeScenario,
                    onClick = { onSelect(scenario, activeData ?: MockDataScenario.BusyDay) },
                )
            }
        }

        KlinaraCard(title = "Oturum sonrası veri") {
            MockDataScenario.entries.forEach { data ->
                ScenarioRow(
                    label = data.turkishName,
                    detail = data.detail,
                    selected = data == activeData,
                    onClick = { onSelect(activeScenario ?: MockScenario.PasswordThenTotp, data) },
                )
            }
        }
    }
}

@Composable
private fun ScenarioRow(
    label: String,
    detail: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .klinaraClickable(true, Role.RadioButton, interaction, onClick)
                .padding(vertical = KlinaraMetrics.xs),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        if (selected) {
            KlinaraBadge(label, tone = KlinaraBadgeTone.Positive)
        } else {
            Text(label, style = KlinaraType.bodyL, color = KlinaraTheme.colors.charcoal)
        }
        Text(detail, style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
    }
}
