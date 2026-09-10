package com.klinara.android.designsystem

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable

/**
 * Marka teması.
 *
 * Material3 yalnız **taşıyıcı** olarak alınır: ripple, imleç rengi, `Checkbox`,
 * `Snackbar` ve erişilebilirlik varsayılanları marka değerlerini miras alsın diye
 * `ColorScheme` bizim token'larımızla doldurulur. Ekranlar `MaterialTheme.colorScheme`
 * OKUMAZ — `KlinaraTheme.colors` okur; bu kural detekt ile mekanik olarak zorlanır.
 *
 * **Dinamik renk (Material You) kapalıdır** ve `dynamicLightColorScheme` bu kaynakta
 * hiç geçmez — yanlışlıkla geri açılacak bir şey yok. Beyaz etiketli bir klinik
 * ürününde kullanıcının duvar kâğıdı marka rengini ezemez.
 */
@Composable
fun KlinaraTheme(
    dark: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (dark) DarkKlinaraColors else LightKlinaraColors

    CompositionLocalProvider(LocalKlinaraColors provides colors) {
        MaterialTheme(
            colorScheme = colors.toMaterialScheme(dark),
            typography = KlinaraType.toMaterialTypography(),
            shapes = KlinaraShapes,
        ) {
            // Zemin TAM KANAMALI boyanır: sistem çubuklarının arkası da marka
            // zemini olmalı. İçeriğin inset dolgusunu ekranlar kendisi uygular —
            // burada boyarsak çubukların arkasında pencere zemini görünür kalır.
            Surface(color = colors.surface, contentColor = colors.charcoal, content = content)
        }
    }
}

/** Token erişim noktası. Ekranlar renkleri buradan okur. */
object KlinaraTheme {
    val colors: KlinaraColors
        @Composable @ReadOnlyComposable
        get() = LocalKlinaraColors.current

    /** Tipografi ve ölçüler temaya göre değişmez; düz object olarak açığa çıkar. */
    val type: KlinaraType get() = KlinaraType
    val metrics: KlinaraMetrics get() = KlinaraMetrics
}

private fun KlinaraColors.toMaterialScheme(dark: Boolean) =
    if (dark) {
        darkColorScheme(
            primary = sage,
            onPrimary = surface,
            primaryContainer = sageSoft,
            onPrimaryContainer = charcoal,
            secondary = sageDeep,
            onSecondary = surface,
            background = surface,
            onBackground = charcoal,
            surface = surface,
            onSurface = charcoal,
            surfaceVariant = surfaceRaised,
            onSurfaceVariant = charcoalMuted,
            outline = border,
            outlineVariant = border,
            error = danger,
            onError = surfaceRaised,
        )
    } else {
        lightColorScheme(
            primary = sage,
            onPrimary = surfaceRaised,
            primaryContainer = sageSoft,
            onPrimaryContainer = charcoal,
            secondary = sageDeep,
            onSecondary = surfaceRaised,
            background = surface,
            onBackground = charcoal,
            surface = surface,
            onSurface = charcoal,
            surfaceVariant = surfaceRaised,
            onSurfaceVariant = charcoalMuted,
            outline = border,
            outlineVariant = border,
            error = danger,
            onError = surfaceRaised,
        )
    }

/**
 * Material'ın kendi bileşenleri (Snackbar, Dialog, TextField imleci) bir `Typography`
 * bekliyor. Marka stillerimiz en yakın Material yuvalarına eşlenir; ekranlarımız
 * yine `KlinaraType`'ı doğrudan kullanır.
 */
private fun KlinaraType.toMaterialTypography() =
    Typography(
        displayLarge = displayL,
        displayMedium = displayM,
        headlineLarge = displayM,
        headlineMedium = titleM,
        headlineSmall = titleM,
        titleLarge = titleM,
        titleMedium = bodyEmphasis,
        titleSmall = bodyEmphasis,
        bodyLarge = bodyL,
        bodyMedium = bodyM,
        bodySmall = bodyM,
        labelLarge = button,
        labelMedium = label,
        labelSmall = label,
    )
