package com.klinara.android.designsystem.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role

/**
 * Marka tıklama davranışı.
 *
 * Ripple KAPALI: geri bildirim tüm kontrole uygulanan bir sönme
 * ([KlinaraMetrics.PRESSED_ALPHA]) — iOS ile aynı his, ve dalga efekti marka
 * kişiliği "calm, authoritative" ile çelişiyor.
 *
 * [minimumInteractiveComponentSize] her tıklanabilir öğeye 48dp taban verir; §7.3
 * bunu batch kapanış ölçütü yapıyor ve tek tek hatırlamaya bırakılamayacak kadar
 * kolay unutuluyor.
 */
internal fun Modifier.klinaraClickable(
    enabled: Boolean,
    role: Role,
    interactionSource: MutableInteractionSource,
    onClick: () -> Unit,
): Modifier =
    this
        .minimumInteractiveComponentSize()
        .clickable(
            interactionSource = interactionSource,
            indication = null,
            enabled = enabled,
            role = role,
            onClick = onClick,
        )
