package com.klinara.android.designsystem.components

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Tüm giriş ekranlarının ortak iskeleti.
 *
 * Başlık hizası, kenar boşluğu ve alt aksiyon alanı **tek yerde** tanımlıdır; ekranlar
 * arasında geçerken başlığın bir piksel kayması bu sayede imkânsız. Ekranlar yalnız
 * kendi içeriklerini ve aksiyonlarını verir.
 *
 * Aksiyon alanı altta **sabit** durur ve klavye açılınca `imePadding` ile yukarı
 * gelir — birincil buton klavyenin altında kaybolmaz.
 *
 * Geri düğmesi yalnız [onBack] verildiğinde çizilir; `AuthFlowViewModel.canGoBack`
 * false olan adımlarda giriş noktası hiç görünmez (§7.4 mantığının iskeleteki karşılığı).
 */
@Composable
fun AuthScaffold(
    title: String,
    modifier: Modifier = Modifier,
    eyebrow: String? = null,
    subtitle: String? = null,
    showsLogo: Boolean = false,
    onBack: (() -> Unit)? = null,
    actions: @Composable ColumnScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = KlinaraTheme.colors
    val scrollState = rememberScrollState()

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .statusBarsPadding()
                .imePadding(),
    ) {
        NavigationBar(onBack = onBack)

        Column(
            modifier =
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(scrollState)
                    .padding(
                        start = KlinaraMetrics.screenInset,
                        end = KlinaraMetrics.screenInset,
                        top = KlinaraMetrics.md,
                        bottom = KlinaraMetrics.xl,
                    ),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.headerToContent),
        ) {
            Header(eyebrow = eyebrow, title = title, subtitle = subtitle, showsLogo = showsLogo)
            Column(
                verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
                content = content,
            )
        }

        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(
                        horizontal = KlinaraMetrics.screenInset,
                        vertical = KlinaraMetrics.md,
                    ),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            content = actions,
        )
    }
}

@Composable
private fun NavigationBar(onBack: (() -> Unit)?) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(KlinaraMetrics.minTouchTarget)
                .padding(horizontal = KlinaraMetrics.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            val interaction = remember { MutableInteractionSource() }
            Box(
                modifier =
                    Modifier
                        .size(KlinaraMetrics.minTouchTarget)
                        .klinaraClickable(
                            enabled = true,
                            role = Role.Button,
                            interactionSource = interaction,
                            onClick = onBack,
                        ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Geri",
                    tint = KlinaraTheme.colors.charcoal,
                    modifier = Modifier.size(BACK_ICON_SIZE),
                )
            }
        }
    }
}

@Composable
private fun Header(
    eyebrow: String?,
    title: String,
    subtitle: String?,
    showsLogo: Boolean,
) {
    val colors = KlinaraTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md)) {
        if (showsLogo) {
            KlinaraLogoMark(size = SCAFFOLD_LOGO_SIZE)
        }
        Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
            if (eyebrow != null) {
                Text(
                    KlinaraType.labelText(eyebrow),
                    style = KlinaraType.label,
                    color = colors.charcoalMuted,
                )
            }
            Text(title, style = KlinaraType.displayL, color = colors.charcoal)
            if (subtitle != null) {
                Text(subtitle, style = KlinaraType.bodyL, color = colors.charcoalMuted)
            }
        }
    }
}

private val BACK_ICON_SIZE = 24.dp
private val SCAFFOLD_LOGO_SIZE = 56.dp
