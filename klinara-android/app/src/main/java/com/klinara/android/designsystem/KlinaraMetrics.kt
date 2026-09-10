package com.klinara.android.designsystem

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.tween
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Ölçü ve hareket sabitleri. 4dp grid; cömert boşluk tasarımın
 * "clinical breathing room" ilkesinin doğrudan karşılığıdır.
 *
 * CompositionLocal DEĞİL, düz `object`: temaya göre değişmiyorlar. CompositionLocal
 * saf dolaylılık olur ve `Modifier.padding(KlinaraMetrics.md)`'yi composable olmayan
 * yardımcılarda yazmayı engellerdi.
 */
object KlinaraMetrics {
    // --- Boşluk (4dp grid) ---
    val xs: Dp = 4.dp
    val sm: Dp = 8.dp
    val md: Dp = 16.dp
    val lg: Dp = 24.dp
    val xl: Dp = 32.dp
    val xxl: Dp = 40.dp

    /** Ekran yatay kenar boşluğu — her auth ekranında aynı. */
    val screenInset: Dp = 24.dp

    /** Başlık bloğu ile ilk alan arası. */
    val headerToContent: Dp = 32.dp

    /** Bağımsız bölümler arası. */
    val sectionGap: Dp = 40.dp

    // --- Yarıçap ---
    val controlRadius: Dp = 12.dp
    val cardRadius: Dp = 16.dp

    // --- Kontrol ölçüleri ---
    val controlHeight: Dp = 52.dp
    val fieldHeight: Dp = 52.dp
    val borderWidth: Dp = 1.dp
    val focusBorderWidth: Dp = 1.5.dp

    /**
     * Android erişilebilirlik tabanı. iOS'ta karşılığı 44pt; Material 48dp istiyor ve
     * §7.3 bunu batch kapanış ölçütü yapıyor.
     */
    val minTouchTarget: Dp = 48.dp

    // --- Hareket ---
    // Sakin ve ölçülü. Zıplayan, dikkat çeken animasyon YOK — marka kişiliği
    // "calm, authoritative". Süreler iOS ile birebir.

    /** Akış adımları arası geçiş (iOS `.smooth(duration: 0.28)`). */
    val stepTransition: FiniteAnimationSpec<Float> =
        tween(durationMillis = 280, easing = CubicBezierEasing(0.4f, 0f, 0.2f, 1f))

    /** Hata görünüp kaybolurken (iOS `.snappy(duration: 0.2)`). */
    val feedback: FiniteAnimationSpec<Float> =
        tween(durationMillis = 200, easing = CubicBezierEasing(0.3f, 0f, 0.1f, 1f))

    const val STEP_TRANSITION_MILLIS: Int = 280
    const val FEEDBACK_MILLIS: Int = 200

    /** Basılı hâl: tüm kontrole uygulanan alfa, renk değil. */
    const val PRESSED_ALPHA: Float = 0.72f
}

/** Material3'ün taşıyıcı olarak kullandığı şekiller — bizim yarıçaplarımızla. */
internal val KlinaraShapes =
    Shapes(
        extraSmall = RoundedCornerShape(KlinaraMetrics.sm),
        small = RoundedCornerShape(KlinaraMetrics.controlRadius),
        medium = RoundedCornerShape(KlinaraMetrics.cardRadius),
        large = RoundedCornerShape(KlinaraMetrics.cardRadius),
        extraLarge = RoundedCornerShape(KlinaraMetrics.xl),
    )
