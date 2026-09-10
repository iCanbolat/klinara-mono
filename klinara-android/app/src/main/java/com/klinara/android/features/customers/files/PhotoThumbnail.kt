package com.klinara.android.features.customers.files

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.services.files.CustomerFile
import com.klinara.android.services.files.FilePosition
import com.klinara.android.services.files.ThumbnailCache

/**
 * Izgara küçük resmi.
 *
 * **Yer tutucu iki ayrı şey söyler:** küçük görsel henüz üretilmediyse "hazırlanıyor",
 * indirilemediyse "görüntülenemiyor". İkisini tek ikonla göstermek, geçici bir
 * gecikmeyi kalıcı bir hata gibi göstermek olurdu.
 *
 * Görüntü `ThumbnailCache`ten geliyor — **adres değil görüntü** önbellekleniyor,
 * dolayısıyla kaydırma erişim kaydı üretmiyor.
 */
@Composable
fun PhotoThumbnail(
    file: CustomerFile,
    cache: ThumbnailCache,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    var bitmap by remember(file.id) { mutableStateOf<Bitmap?>(null) }

    LaunchedEffect(file.id, file.hasThumbnail) {
        bitmap = cache.thumbnail(file)
    }

    Box(
        modifier =
            modifier
                .aspectRatio(1f)
                .clip(RoundedCornerShape(KlinaraMetrics.controlRadius))
                .background(colors.disabled)
                .klinaraClickable(true, Role.Button, interactionSource, onClick)
                .semantics {
                    contentDescription =
                        "${file.position.turkishName} fotoğraf, ${file.kind.turkishName}"
                },
    ) {
        val image = bitmap
        if (image != null) {
            Image(
                bitmap = image.asImageBitmap(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Icon(
                imageVector = Icons.Filled.Info,
                contentDescription = null,
                tint = colors.charcoalMuted,
                modifier = Modifier.align(Alignment.Center),
            )
        }

        // Konum rozeti yalnız ANLAMLI olduğunda: "Diğer" bir bilgi taşımıyor.
        if (file.position != FilePosition.Other) {
            KlinaraBadge(
                text = file.position.turkishName,
                tone = KlinaraBadgeTone.Neutral,
                modifier = Modifier.align(Alignment.BottomStart).padding(KlinaraMetrics.xs),
            )
        }
    }
}
