package com.klinara.android.features.customers.files

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.services.files.CustomerFile
import com.klinara.android.services.files.ThumbnailCache
import com.klinara.android.services.networking.Loadable

/**
 * Dosyalar bölümü — **iki ayrı kart, iki ayrı izin**.
 *
 * Fotoğraf sağlık verisidir (`customer.medical:*`), belge değildir (`customer:*`).
 * Kimlik fotokopisiyle klinik fotoğrafı aynı kapının arkasına koymak, ya belgeyi
 * gereksiz kısıtlamak ya fotoğrafı gereksiz açmak olurdu.
 *
 * ⚠️ **Yükleme sayfaları bu kartların DIŞINA bağlanır** (çağıran tarafta). iOS'ta
 * bunlar fotoğraf kartına asılıydı ve `customer.medical:*` izni olmayan kullanıcıda
 * "Belge ekle" düğmesi **ölüydü** — düzeltilmiş bir hata, tekrarlanmamalı.
 */
@Composable
fun CustomerFilesSection(
    state: CustomerFilesUiState,
    thumbnails: ThumbnailCache,
    canReadMedical: Boolean,
    canWriteMedical: Boolean,
    canWrite: Boolean,
    onOpenPhoto: (String) -> Unit,
    onOpenDocument: (String) -> Unit,
    onAddPhoto: () -> Unit,
    onAddDocument: () -> Unit,
    onOpenGroups: () -> Unit,
    onDismissError: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.lg),
    ) {
        state.error?.let {
            ErrorBanner(message = it, retryLabel = "Kapat", onRetry = onDismissError)
        }

        state.uploadStep?.let { step ->
            // Adım adım söyleniyor: "adres alınamadı" ile "yükleme kesildi" farklı
            // sorunlar ve farklı çözümleri var.
            KlinaraCard(title = "Yükleniyor") {
                Text(step.turkishName, style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            }
        }

        // Fotoğraflar YALNIZ klinik okuma izniyle çizilir.
        if (canReadMedical) {
            PhotosCard(
                state = state,
                thumbnails = thumbnails,
                canWriteMedical = canWriteMedical,
                onOpenPhoto = onOpenPhoto,
                onAddPhoto = onAddPhoto,
                onOpenGroups = onOpenGroups,
            )
        } else {
            KlinaraCard(title = "Fotoğraflar") {
                // "Yok" demiyoruz: klinik fotoğraf OLABİLİR ve göremediğimizi
                // söylemek, olmadığını söylemekten dürüst.
                Text(
                    "Klinik fotoğrafları görme yetkiniz yok. Bu müşterinin fotoğrafı olabilir.",
                    style = KlinaraType.bodyM,
                    color = KlinaraTheme.colors.charcoalMuted,
                )
            }
        }

        DocumentsCard(
            documents = state.documents,
            files = state.files,
            canWrite = canWrite,
            onOpenDocument = onOpenDocument,
            onAddDocument = onAddDocument,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PhotosCard(
    state: CustomerFilesUiState,
    thumbnails: ThumbnailCache,
    canWriteMedical: Boolean,
    onOpenPhoto: (String) -> Unit,
    onAddPhoto: () -> Unit,
    onOpenGroups: () -> Unit,
) {
    val colors = KlinaraTheme.colors

    KlinaraCard(
        title = "Fotoğraflar",
        footnote = "Klinik fotoğraflar sağlık verisidir ve uygulama dışına paylaşılamaz.",
    ) {
        when (val files = state.files) {
            Loadable.Loading ->
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = colors.charcoalMuted)

            is Loadable.Failed -> ErrorBanner(message = files.message)

            is Loadable.Loaded ->
                if (state.photos.isEmpty()) {
                    Text("Henüz fotoğraf yok.", style = KlinaraType.bodyM, color = colors.charcoalMuted)
                } else {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
                        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
                    ) {
                        state.photos.forEach { photo ->
                            PhotoThumbnail(
                                file = photo,
                                cache = thumbnails,
                                onClick = { onOpenPhoto(photo.id) },
                                modifier = Modifier.width(THUMBNAIL_SIZE),
                            )
                        }
                    }
                }
        }

        KlinaraNavigationRow(
            label = "Öncesi / sonrası",
            value = "Karşılaştırma grupları",
            onClick = onOpenGroups,
            modifier = Modifier.fillMaxWidth(),
        )

        if (canWriteMedical) {
            KlinaraButton(
                title = "Fotoğraf ekle",
                onClick = onAddPhoto,
                kind = KlinaraButtonKind.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun DocumentsCard(
    documents: List<CustomerFile>,
    files: Loadable<List<CustomerFile>>,
    canWrite: Boolean,
    onOpenDocument: (String) -> Unit,
    onAddDocument: () -> Unit,
) {
    val colors = KlinaraTheme.colors

    KlinaraCard(title = "Belgeler") {
        when (files) {
            Loadable.Loading ->
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = colors.charcoalMuted)

            is Loadable.Failed -> ErrorBanner(message = files.message)

            is Loadable.Loaded ->
                if (documents.isEmpty()) {
                    Text("Henüz belge yok.", style = KlinaraType.bodyM, color = colors.charcoalMuted)
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
                        documents.forEach { document ->
                            KlinaraNavigationRow(
                                label = com.klinara.android.services.files.FileContentType
                                    .turkishName(document.mimeType),
                                value = ByteSize.format(document.sizeBytes),
                                onClick = { onOpenDocument(document.id) },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
        }

        if (canWrite) {
            KlinaraButton(
                title = "Belge ekle",
                onClick = onAddDocument,
                kind = KlinaraButtonKind.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** Bayt → okunabilir boyut. */
object ByteSize {
    fun format(bytes: Long): String =
        when {
            bytes >= MEGABYTE -> "%.1f MB".format(bytes.toDouble() / MEGABYTE)
            bytes >= KILOBYTE -> "%.0f KB".format(bytes.toDouble() / KILOBYTE)
            else -> "$bytes B"
        }

    private const val KILOBYTE = 1024.0
    private const val MEGABYTE = 1024.0 * 1024
}

private val THUMBNAIL_SIZE = 92.dp
