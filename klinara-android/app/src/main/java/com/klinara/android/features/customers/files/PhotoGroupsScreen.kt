package com.klinara.android.features.customers.files

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.services.files.FileGroup
import com.klinara.android.services.files.FilePosition
import com.klinara.android.services.files.ThumbnailCache
import com.klinara.android.services.networking.Loadable

/**
 * Öncesi/sonrası karşılaştırma grupları.
 *
 * ⚠️ **Boş slot YALNIZ `customer.medical:write` varken tıklanabilir.** İzinsiz
 * kullanıcıda atıl kalıyor: dokunup izin hatası almak, hiç dokunamamaktan kötüdür
 * (§7.4).
 */
@Composable
fun PhotoGroupsScreen(
    groups: Loadable<List<FileGroup>>,
    thumbnails: ThumbnailCache,
    canWriteMedical: Boolean,
    error: String?,
    onDismissError: () -> Unit,
    onOpenPhoto: (String) -> Unit,
    onAddToSlot: (groupId: String, position: FilePosition) -> Unit,
    onCreateGroup: (title: String, bodyArea: String?) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    var showEditor by remember { mutableStateOf(false) }

    KlinaraScreen(title = "Öncesi / sonrası", modifier = modifier, onBack = onBack) {
        error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = onDismissError) }

        when (groups) {
            Loadable.Loading ->
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = colors.charcoalMuted)

            is Loadable.Failed -> ErrorBanner(message = groups.message)

            is Loadable.Loaded ->
                if (groups.value.isEmpty()) {
                    Text(
                        "Henüz karşılaştırma grubu yok. Bir grup açıp öncesi ve sonrası " +
                            "fotoğraflarını yan yana tutabilirsiniz.",
                        style = KlinaraType.bodyM,
                        color = colors.charcoalMuted,
                    )
                } else {
                    groups.value.forEach { group ->
                        GroupCard(
                            group = group,
                            thumbnails = thumbnails,
                            canWriteMedical = canWriteMedical,
                            onOpenPhoto = onOpenPhoto,
                            onAddToSlot = onAddToSlot,
                        )
                    }
                }
        }

        if (canWriteMedical) {
            KlinaraButton(
                title = "Yeni grup",
                onClick = { showEditor = true },
                kind = KlinaraButtonKind.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }

    if (showEditor) {
        GroupEditorDialog(
            onCreate = { title, area ->
                showEditor = false
                onCreateGroup(title, area)
            },
            onDismiss = { showEditor = false },
        )
    }
}

@Composable
private fun GroupCard(
    group: FileGroup,
    thumbnails: ThumbnailCache,
    canWriteMedical: Boolean,
    onOpenPhoto: (String) -> Unit,
    onAddToSlot: (String, FilePosition) -> Unit,
) {
    KlinaraCard(title = group.title, footnote = group.bodyArea) {
        Row(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
            listOf(FilePosition.Before, FilePosition.After).forEach { position ->
                val file = group.file(position)
                Column(
                    modifier = Modifier.weight(1f, fill = true),
                    verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
                ) {
                    Text(
                        text = position.turkishName,
                        style = KlinaraType.label,
                        color = KlinaraTheme.colors.charcoalMuted,
                    )
                    if (file != null) {
                        PhotoThumbnail(
                            file = file,
                            cache = thumbnails,
                            onClick = { onOpenPhoto(file.id) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    } else {
                        EmptySlot(
                            canWriteMedical = canWriteMedical,
                            onClick = { onAddToSlot(group.id, position) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptySlot(
    canWriteMedical: Boolean,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }

    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(RoundedCornerShape(KlinaraMetrics.controlRadius))
                .background(colors.disabled)
                // İzinsiz kullanıcıda ATIL: tıklanabilir göstermek, dokunulunca hiçbir
                // şey olmaması ya da izin hatası demekti.
                .let {
                    if (canWriteMedical) {
                        it.klinaraClickable(true, Role.Button, interactionSource, onClick)
                    } else {
                        it
                    }
                },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = if (canWriteMedical) "Fotoğraf ekle" else "Boş",
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
        )
    }
}

@Composable
private fun GroupEditorDialog(
    onCreate: (String, String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var bodyArea by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Yeni karşılaştırma grubu", style = KlinaraType.titleM) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md)) {
                KlinaraTextField(
                    label = "Başlık",
                    value = title,
                    onValueChange = { title = it },
                    placeholder = "Sağ kol — 3. seans",
                )
                KlinaraTextField(
                    label = "Vücut bölgesi",
                    value = bodyArea,
                    onValueChange = { bodyArea = it },
                    placeholder = "sağ kol",
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(title.trim(), bodyArea.trim().takeIf { it.isNotEmpty() }) },
                enabled = title.isNotBlank(),
            ) { Text("Oluştur") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Vazgeç") } },
        containerColor = KlinaraTheme.colors.surfaceRaised,
    )
}
