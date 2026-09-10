package com.klinara.android.features.customers.files

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.services.files.CustomerFile
import com.klinara.android.services.files.FileVariant
import com.klinara.android.services.files.FilesService
import com.klinara.android.services.networking.ApiError
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Tam ekran fotoğraf.
 *
 * ⚠️ **Her açılış bir `download` erişim kaydı üretir** — tam boyut adres yalnız burada,
 * yalnız kullanıcı eylemiyle çekiliyor ve **önbelleğe alınmıyor**. Izgara `view`
 * kaydı üretiyor; sunucu ikisini ayırıyor ve "kim gerçekten dosyayı açtı" sorusu
 * kaydırma gürültüsünün içinde kaybolmuyor.
 *
 * **Paylaş düğmesi YOKTUR** (§9, kalıcı karar) ve [SecureScreen] ekran görüntüsünü
 * kapatır.
 */
@Composable
fun PhotoDetailScreen(
    file: CustomerFile?,
    files: FilesService,
    http: OkHttpClient,
    canDelete: Boolean,
    onDelete: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    SecureScreen()

    val colors = KlinaraTheme.colors
    var bitmap by remember(file?.id) { mutableStateOf<Bitmap?>(null) }
    var error by remember(file?.id) { mutableStateOf<String?>(null) }
    var askDelete by remember { mutableStateOf(false) }
    var scale by remember(file?.id) { mutableFloatStateOf(1f) }

    LaunchedEffect(file?.id) {
        val target = file ?: return@LaunchedEffect
        try {
            val address = files.downloadUrl(target.id, FileVariant.Original)
            bitmap =
                runCatching {
                    http.newCall(Request.Builder().url(address.url).build()).execute().use { response ->
                        if (response.isSuccessful) {
                            response.body.byteStream().use { BitmapFactory.decodeStream(it) }
                        } else {
                            null
                        }
                    }
                }.getOrNull()
            if (bitmap == null) error = "Fotoğraf görüntülenemedi."
        } catch (apiError: ApiError) {
            error = apiError.displayMessage
        }
    }

    KlinaraScreen(
        title = file?.position?.turkishName ?: "Fotoğraf",
        modifier = modifier,
        onBack = onBack,
        scrollable = false,
    ) {
        error?.let { ErrorBanner(message = it) }

        ZoomableImage(
            bitmap = bitmap,
            showLoading = error == null,
            scale = scale,
            onScale = { scale = it },
            key = file?.id,
        )

        if (canDelete && file != null) {
            KlinaraButton(
                title = "Fotoğrafı sil",
                onClick = { askDelete = true },
                kind = KlinaraButtonKind.Tertiary,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }

    if (askDelete && file != null) {
        DeletePhotoDialog(
            onConfirm = {
                askDelete = false
                onDelete(file.id)
            },
            onDismiss = { askDelete = false },
        )
    }
}

@Composable
private fun ZoomableImage(
    bitmap: Bitmap?,
    showLoading: Boolean,
    scale: Float,
    onScale: (Float) -> Unit,
    key: String?,
) {
    val colors = KlinaraTheme.colors

    Box(
        modifier = Modifier.fillMaxSize().background(colors.charcoal),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "Klinik fotoğraf, tam ekran",
                contentScale = ContentScale.Fit,
                modifier =
                    Modifier
                        .fillMaxSize()
                        .graphicsLayer(scaleX = scale, scaleY = scale)
                        .pointerInput(key) {
                            detectTransformGestures { _, _, zoom, _ ->
                                // 1'in altına inmeye izin verilmiyor: küçülen bir
                                // fotoğraf, kullanıcıya kaybolmuş gibi görünür.
                                onScale((scale * zoom).coerceIn(MIN_SCALE, MAX_SCALE))
                            }
                        },
            )
        } else if (showLoading) {
            Text("Yükleniyor…", style = KlinaraType.bodyM, color = colors.surface)
        }
    }
}

@Composable
private fun DeletePhotoDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Fotoğraf silinsin mi?", style = KlinaraType.titleM) },
        text = {
            // Nesne depoda KALIYOR ve bunu söylemek dürüstlük: "sildim" demek,
            // saklama yükümlülüğünü gizlemek olurdu.
            Text(
                "Fotoğraf karttan kaldırılır. Saklama yükümlülüğü gereği dosyanın " +
                    "kendisi depoda bir süre daha tutulur.",
                style = KlinaraType.bodyM,
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Sil") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Vazgeç") } },
        containerColor = KlinaraTheme.colors.surfaceRaised,
    )
}

private const val MIN_SCALE = 1f
private const val MAX_SCALE = 4f
