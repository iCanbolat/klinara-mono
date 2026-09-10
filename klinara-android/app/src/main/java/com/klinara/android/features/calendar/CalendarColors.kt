package com.klinara.android.features.calendar

import androidx.compose.ui.graphics.Color

/**
 * Sunucudan gelen `#RRGGBB` personel rengini `Color`'a çevirir.
 *
 * **Bu bir token okuması değil, bir VERİ okuması.** `calendarColor` sunucuda kliniğin
 * kendi seçtiği bir alan; marka paletiyle ilgisi yok ve `KlinaraColors`'a giremez.
 * Ama ekranda tek başına anlam taşımaz (WCAG 1.4.1): her blokta ad, saat ve durum
 * metin olarak da var.
 *
 * Geçersiz ya da eksik değerde [fallback]'e düşülür — sunucunun bir gün `null`
 * göndermesi bir çökme sebebi değil, renksiz bir noktadır.
 */
fun accentColor(
    hex: String?,
    fallback: Color,
): Color {
    val cleaned = hex?.trim()?.removePrefix("#") ?: return fallback
    if (cleaned.length != RGB_LENGTH) return fallback
    val value = cleaned.toLongOrNull(HEX_RADIX) ?: return fallback
    return Color(value or OPAQUE_ALPHA)
}

private const val RGB_LENGTH = 6
private const val HEX_RADIX = 16
private const val OPAQUE_ALPHA = 0xFF000000L
