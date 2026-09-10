package com.klinara.android.designsystem

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Marka renk token'ları.
 *
 * Değerler iOS `Assets.xcassets` ile **birebir** aynıdır; bir token değiştiğinde iki
 * istemcide de değişmeli (ANDROID_DEVELOPMENT.md §1 Kural 3). Ham hex hiçbir ekranda
 * görünmez — ekranlar `KlinaraTheme.colors` üzerinden okur.
 */
@Immutable
data class KlinaraColors(
    /** Birincil aksiyon, aktif durum, başarı. */
    val sage: Color,
    /** Basılı hâl, vurgu. */
    val sageDeep: Color,
    /** Seçili satır, bilgi zemini. */
    val sageSoft: Color,
    /** Başlık ve gövde metni. */
    val charcoal: Color,
    /** İkincil metin. */
    val charcoalMuted: Color,
    /** Sayfa zemini — saf beyaz değil, sıcak kırık beyaz. */
    val surface: Color,
    /** Kart ve input zemini. */
    val surfaceRaised: Color,
    /** Kenarlık. */
    val border: Color,
    /** Odaklı kenarlık. iOS'ta `sage`'in takma adı. */
    val borderFocus: Color,
    /** Devre dışı kontrol dolgusu. */
    val disabled: Color,
    /** Hata, yıkıcı işlem. */
    val danger: Color,
    /** Bu paletin karanlık tema olup olmadığı — sistem çubuğu ikonları için. */
    val isDark: Boolean,
)

internal val LightKlinaraColors =
    KlinaraColors(
        sage = Color(0xFF7F9A76),
        sageDeep = Color(0xFF5E7856),
        sageSoft = Color(0xFFEAF0E7),
        charcoal = Color(0xFF2E3532),
        charcoalMuted = Color(0xFF6E7A74),
        surface = Color(0xFFFAF8F5),
        surfaceRaised = Color(0xFFFFFFFF),
        border = Color(0xFFDFD9D0),
        borderFocus = Color(0xFF7F9A76),
        disabled = Color(0xFFEDE9E3),
        danger = Color(0xFFA6483C),
        isDark = false,
    )

internal val DarkKlinaraColors =
    KlinaraColors(
        sage = Color(0xFF9DB894),
        sageDeep = Color(0xFF7F9A76),
        sageSoft = Color(0xFF2A322A),
        charcoal = Color(0xFFF2EFEA),
        charcoalMuted = Color(0xFFA9B2AC),
        surface = Color(0xFF161917),
        surfaceRaised = Color(0xFF20241F),
        border = Color(0xFF33383A),
        borderFocus = Color(0xFF9DB894),
        disabled = Color(0xFF2A2E2C),
        danger = Color(0xFFD08074),
        isDark = true,
    )

/**
 * Türetilmiş opaklıklar tablo satırı değil, taban token'ın deterministik fonksiyonudur.
 * Tabloya yazmak light/dark satırlarını ikiye katlar ve iki drift noktası yaratır.
 */
val KlinaraColors.dangerSurface: Color get() = danger.copy(alpha = 0.08f)
val KlinaraColors.dangerBorder: Color get() = danger.copy(alpha = 0.35f)
val KlinaraColors.badgeNeutralSurface: Color get() = border.copy(alpha = 0.40f)
val KlinaraColors.badgeMutedSurface: Color get() = border.copy(alpha = 0.25f)
val KlinaraColors.warningSurface: Color get() = danger.copy(alpha = 0.12f)
val KlinaraColors.trackBorder: Color get() = border.copy(alpha = 0.30f)
val KlinaraColors.overlayScrim: Color get() = surface.copy(alpha = 0.86f)

/**
 * `staticCompositionLocalOf` bilinçli: palet yalnız light/dark dönüşünde değişir ve o
 * anda tüm ağacın recompose olması *doğrudur*; kalan zamanda statik okuma bedavadır.
 */
val LocalKlinaraColors =
    staticCompositionLocalOf<KlinaraColors> {
        error("KlinaraTheme yok — bu composable KlinaraTheme { } içinde olmalı.")
    }
