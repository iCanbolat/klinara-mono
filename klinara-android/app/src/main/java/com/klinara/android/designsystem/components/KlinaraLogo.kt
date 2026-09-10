package com.klinara.android.designsystem.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.klinara.android.R
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Marka işareti. Varlık iOS `Assets.xcassets/LogoMark` ile **aynı dosyadır**
 * (1x/2x/3x → mdpi/xhdpi/xxhdpi), böylece iki istemcide birebir aynı işaret çizilir.
 *
 * `clearAndSetSemantics {}` ile ekran okuyucudan gizlenir: yanındaki kelime işareti
 * zaten "Klinara" diyor, iki kez duyurmak gürültüdür. Tek başına kullanıldığı
 * yerlerde (splash) da bilgi taşımıyor — dekoratif.
 */
@Composable
fun KlinaraLogoMark(
    modifier: Modifier = Modifier,
    size: Dp = LOGO_DEFAULT_SIZE,
) {
    Image(
        painter = painterResource(R.drawable.klinara_logo_mark),
        contentDescription = null,
        contentScale = ContentScale.Fit,
        modifier = modifier.size(size).clearAndSetSemantics {},
    )
}

/** İşaret + "KLINARA" kelime işareti. Geniş tracking marka kimliğinin parçası. */
@Composable
fun KlinaraWordmark(
    modifier: Modifier = Modifier,
    markSize: Dp = WORDMARK_MARK_SIZE,
    showsMark: Boolean = true,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        if (showsMark) KlinaraLogoMark(size = markSize)
        Text(
            text = "KLINARA",
            style = KlinaraType.titleM.copy(letterSpacing = WORDMARK_TRACKING),
            color = KlinaraTheme.colors.charcoal,
        )
    }
}

private val LOGO_DEFAULT_SIZE = 72.dp
private val WORDMARK_MARK_SIZE = 64.dp
private val WORDMARK_TRACKING = 6.sp
