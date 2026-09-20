package com.klinara.android.features.customers.files

import android.content.Context
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.core.graphics.createBitmap
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.services.files.CustomerFile
import com.klinara.android.services.files.FileContentType
import com.klinara.android.services.files.FileVariant
import com.klinara.android.services.files.FilesService
import com.klinara.android.services.networking.ApiError
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Belge önizleme — **platform `PdfRenderer`** ile.
 *
 * Üçüncü parti bir PDF kütüphanesi bir sağlık verisi dosyasını okuyacaktı; bağımlılık
 * yüzeyi **bilinçle sıfır** (§3).
 *
 * `PdfRenderer` bir dosya tanıtıcısı istiyor ama içerik yalnız kısa ömürlü imzalı bir
 * adresin arkasında; bu yüzden geçici dizine yazılıyor ve **ekrandan çıkarken
 * siliniyor** — silinmiş bir belge sandbox'ta yaşamaya devam etmemeli (§7.9).
 */
@Composable
fun DocumentPreviewScreen(
    file: CustomerFile?,
    files: FilesService,
    http: OkHttpClient,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val colors = KlinaraTheme.colors
    var pages by remember(file?.id) { mutableStateOf<List<Bitmap>>(emptyList()) }
    var error by remember(file?.id) { mutableStateOf<String?>(null) }
    var tempFile by remember(file?.id) { mutableStateOf<File?>(null) }

    LaunchedEffect(file?.id) {
        val target = file ?: return@LaunchedEffect
        try {
            // Her açılış bir `download` erişim kaydı üretir; adres önbelleğe alınmıyor.
            val address = files.downloadUrl(target.id, FileVariant.Original)
            withContext(Dispatchers.IO) {
                val downloaded = download(context, http, address.url, target)
                if (downloaded == null) {
                    error = "Belge indirilemedi."
                    return@withContext
                }
                tempFile = downloaded
                pages =
                    if (target.mimeType == FileContentType.PDF) {
                        renderPdf(downloaded)
                    } else {
                        listOfNotNull(android.graphics.BitmapFactory.decodeFile(downloaded.path))
                    }
                if (pages.isEmpty()) error = "Belge görüntülenemedi."
            }
        } catch (apiError: ApiError) {
            error = apiError.displayMessage
        }
    }

    // Geçici dosya ekrandan çıkarken SİLİNİR.
    DisposableEffect(file?.id) {
        onDispose { tempFile?.delete() }
    }

    KlinaraScreen(
        title = file?.let { FileContentType.turkishName(it.mimeType) } ?: "Belge",
        modifier = modifier,
        onBack = onBack,
    ) {
        error?.let { ErrorBanner(message = it) }

        if (pages.isEmpty() && error == null) {
            KlinaraSkeleton(style = KlinaraSkeletonStyle.cardsShort)
        }

        KlinaraCard {
            Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
                pages.forEach { page ->
                    Image(
                        bitmap = page.asImageBitmap(),
                        contentDescription = "Belge sayfası",
                        contentScale = ContentScale.FillWidth,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

private fun download(
    context: Context,
    http: OkHttpClient,
    url: String,
    file: CustomerFile,
): File? =
    runCatching {
        http.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) return null
            // Uzantı ZORUNLU değil ama tutarlı: `PdfRenderer` içeriğe bakıyor.
            val target = File(context.cacheDir, "${file.id}.pdf")
            response.body.byteStream().use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }
            target
        }
    }.getOrNull()

private fun renderPdf(file: File): List<Bitmap> =
    runCatching {
        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
            PdfRenderer(descriptor).use { renderer ->
                (0 until minOf(renderer.pageCount, MAX_PAGES)).map { index ->
                    renderer.openPage(index).use { page ->
                        val bitmap = createBitmap(page.width, page.height)
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        bitmap
                    }
                }
            }
        }
    }.getOrDefault(emptyList())

/** Uzun bir belgenin tamamını belleğe açmak, bir onam metninde 200 sayfa demek olabilir. */
private const val MAX_PAGES = 20
