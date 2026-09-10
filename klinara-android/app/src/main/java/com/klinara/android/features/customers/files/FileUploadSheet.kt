package com.klinara.android.features.customers.files

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.features.customers.SelectableChip
import com.klinara.android.services.files.FileContentType
import com.klinara.android.services.files.FileKind
import com.klinara.android.services.files.FilePosition
import com.klinara.android.services.files.ImageResize

/**
 * Dosya yükleme ekranı.
 *
 * **Photo Picker izin GEREKTİRMEZ** (`PickVisualMedia`) — kullanıcı neyi paylaştığını
 * kendi seçiyor ve uygulama galeriye hiç erişmiyor. Kamera ayrı: `CAMERA` izni ister
 * ve gerekçesi kullanıcıya **açıkça** söyleniyor (iOS `NSCameraUsageDescription`
 * paritesi).
 *
 * Grup ve konum önceden seçili geldiyse **tekrar sorulmaz**: iki kez sormak, iki
 * seçimin ayrışmasına izin vermek olurdu.
 */
@Composable
fun FileUploadSheet(
    kind: FileKind,
    presetGroupId: String?,
    presetPosition: FilePosition?,
    isUploading: Boolean,
    error: String?,
    onDismissError: () -> Unit,
    onUpload: (data: ByteArray, contentType: String, position: FilePosition, groupId: String?) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val colors = KlinaraTheme.colors
    var position by remember { mutableStateOf(presetPosition ?: FilePosition.Other) }
    var localError by remember { mutableStateOf<String?>(null) }

    val pickMedia =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let {
                when (val result = readAndPrepare(context, it, kind)) {
                    is PreparedFile.Ready -> onUpload(result.data, result.contentType, position, presetGroupId)
                    is PreparedFile.Rejected -> localError = result.reason
                }
            }
        }

    val pickDocument =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            uri?.let {
                when (val result = readAndPrepare(context, it, kind)) {
                    is PreparedFile.Ready -> onUpload(result.data, result.contentType, position, presetGroupId)
                    is PreparedFile.Rejected -> localError = result.reason
                }
            }
        }

    KlinaraScreen(
        title = if (kind == FileKind.Photo) "Fotoğraf ekle" else "Belge ekle",
        modifier = modifier,
        onBack = onBack,
    ) {
        error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = onDismissError) }
        localError?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = { localError = null }) }

        if (kind == FileKind.Photo && presetPosition == null) {
            PositionPicker(selected = position, onSelect = { position = it })
        }

        if (presetGroupId != null) {
            KlinaraCard(title = "Grup") {
                // Önceden seçilmiş: tekrar sormuyoruz.
                Text(
                    "Bu fotoğraf seçtiğiniz karşılaştırma grubuna ${position.turkishName.lowercase()} " +
                        "olarak eklenecek.",
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                )
            }
        }

        SourceCard(
            isPhoto = kind == FileKind.Photo,
            enabled = !isUploading,
            onPickPhoto = {
                pickMedia.launch(
                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                )
            },
            onPickDocument = { pickDocument.launch(FileContentType.allowed.toTypedArray()) },
        )

        Text(
            text =
                "Yüklenen dosyalar klinik içinde kalır; uygulama dışına paylaşım yolu " +
                    "bulunmuyor.",
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
        )
    }
}

@Composable
private fun SourceCard(
    isPhoto: Boolean,
    enabled: Boolean,
    onPickPhoto: () -> Unit,
    onPickDocument: () -> Unit,
) {
    KlinaraCard(
        title = "Kaynak",
        footnote =
            if (isPhoto) {
                "Galeriden seçim için izin gerekmez; yalnız seçtiğiniz dosya okunur."
            } else {
                "PDF ve görsel belgeler yüklenebilir; en fazla 25 MB."
            },
    ) {
        KlinaraButton(
            title = if (isPhoto) "Galeriden seç" else "Dosya seç",
            onClick = if (isPhoto) onPickPhoto else onPickDocument,
            kind = KlinaraButtonKind.Secondary,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PositionPicker(
    selected: FilePosition,
    onSelect: (FilePosition) -> Unit,
) {
    KlinaraCard(title = "Konum") {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            FilePosition.entries.forEach { option ->
                SelectableChip(
                    label = option.turkishName,
                    isSelected = selected == option,
                    onClick = { onSelect(option) },
                )
            }
        }
    }
}

/** Hazırlama sonucu — hata SEBEBİYLE birlikte. */
private sealed interface PreparedFile {
    data class Ready(val data: ByteArray, val contentType: String) : PreparedFile

    data class Rejected(val reason: String) : PreparedFile
}

/**
 * Seçilen dosyayı okur, tipini **sihirli bayttan** tespit eder ve gerekiyorsa küçültür.
 *
 * Hatalar **sebebine göre ayrılıyor**: desteklenmeyen tür, çok büyük, küçültülemedi.
 * Üçü de kullanıcıya farklı bir şey söyler; tek bir "yükleme başarısız" mesajı hiçbirini
 * söylemez.
 */
private fun readAndPrepare(
    context: Context,
    uri: Uri,
    kind: FileKind,
): PreparedFile {
    val raw =
        runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
            .getOrNull()
            ?: return PreparedFile.Rejected("Dosya okunamadı.")

    val contentType =
        FileContentType.detect(raw)
            ?: return PreparedFile.Rejected("Bu dosya türü desteklenmiyor.")

    // Belgeler yeniden kodlanmaz; yalnız sınır kontrolü.
    if (kind != FileKind.Photo || contentType == FileContentType.PDF) {
        if (raw.size > FileContentType.MAX_BYTES) {
            return PreparedFile.Rejected("Dosya 25 MB sınırını aşıyor.")
        }
        return PreparedFile.Ready(raw, contentType)
    }

    val bitmap =
        BitmapFactory.decodeByteArray(raw, 0, raw.size)
            ?: return PreparedFile.Rejected("Görsel çözümlenemedi.")
    val encoded =
        ImageResize.encode(bitmap)
            ?: return PreparedFile.Rejected("Görsel yeterince küçültülemedi.")

    // HEIC bilerek JPEG'e dönüyor: sunucu ikisini de kabul ediyor ama JPEG her yerde
    // açılıyor ve küçük görsel üretimi de onun üstünden yürüyor.
    return PreparedFile.Ready(encoded, FileContentType.JPEG)
}
