package com.klinara.android.features.customers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.designsystem.components.KlinaraTextEditor
import com.klinara.android.services.crm.CustomerNote
import com.klinara.android.services.crm.CustomerNoteKind

/**
 * Not oluşturma / düzenleme.
 *
 * **`If-Match` notun AÇILDIĞI ANDAKİ sürümle gider** ([openedVersion]). Store'un
 * güncel sürümünü göndermek kilidi etkisiz kılardı: başkasının bu arada yazdığı metnin
 * üstüne sessizce yazardık ve iyimser kilit hiçbir şeyi korumamış olurdu.
 *
 * Sürüm bu arada arttıysa **ön haber** veriliyor: kaydetme zaten `409` alacağı için
 * kullanıcı metni boşuna yazmasın. Bu bir kilit değil ve kullanıcıya öyle denmiyor.
 */
@Composable
fun NoteEditorScreen(
    note: CustomerNote?,
    canWriteMedical: Boolean,
    /** Store'daki güncel sürüm — [note] açıldığından beri arttıysa uyarı çıkar. */
    currentVersion: Int?,
    isSaving: Boolean,
    error: String?,
    onDismissError: () -> Unit,
    onSave: (body: String, kind: CustomerNoteKind, customerVisible: Boolean, openedVersion: Int?) -> Unit,
    onDelete: ((String) -> Unit)?,
    onOpenRevisions: ((String) -> Unit)?,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Açılış sürümü BİR KEZ yakalanır ve ekran boyunca değişmez.
    val openedVersion = remember(note?.id) { note?.version }
    var body by rememberSaveable(note?.id) { mutableStateOf(note?.body.orEmpty()) }
    var kind by remember(note?.id) { mutableStateOf(note?.kind ?: CustomerNoteKind.General) }
    var customerVisible by rememberSaveable(note?.id) { mutableStateOf(note?.customerVisible ?: false) }
    var askDelete by remember { mutableStateOf(false) }

    val colors = KlinaraTheme.colors
    val availableKinds =
        remember(canWriteMedical) {
            // Klinik not yazamayan kullanıcıya klinik türü SEÇTİRMEK, kaydederken 403
            // almasını sağlamak olurdu.
            if (canWriteMedical) CustomerNoteKind.selectable else listOf(CustomerNoteKind.General)
        }
    val changedElsewhere = openedVersion != null && currentVersion != null && currentVersion > openedVersion

    KlinaraScreen(
        title = if (note == null) "Yeni not" else "Notu düzenle",
        modifier = modifier,
        onBack = onBack,
    ) {
        error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = onDismissError) }

        // Ön haber: kaydetme zaten 409 alacak. Bunu söylememek, kullanıcıya boşuna
        // paragraf yazdırmak olurdu. Bu bir KİLİT DEĞİL ve öyle de denmiyor.
        StaleVersionWarning(visible = changedElsewhere)

        KlinaraCard(title = "Not") {
            KlinaraTextEditor(
                label = "Metin",
                value = body,
                onValueChange = { body = it },
                placeholder = "Seans sırasında gözlenenler…",
            )
        }

        NoteKindCard(
            availableKinds = availableKinds,
            selected = kind,
            canWriteMedical = canWriteMedical,
            onSelect = { kind = it },
        )

        KlinaraCard(
            title = "Görünürlük",
            footnote = "Müşteriye görünür notlar ileride müşteri portalında gösterilecek.",
        ) {
            KlinaraRow(
                label = "Müşteriye görünür",
                accessory = {
                    Switch(checked = customerVisible, onCheckedChange = { customerVisible = it })
                },
            )
        }

        note?.let { existing ->
            NoteHistoryCard(note = existing, onOpenRevisions = onOpenRevisions)
        }

        NoteEditorActions(
            canSave = body.isNotBlank() && !isSaving,
            isSaving = isSaving,
            canDelete = note != null && onDelete != null,
            onSave = { onSave(body, kind, customerVisible, openedVersion) },
            onAskDelete = { askDelete = true },
        )

        Text(
            text = "Not metni her değiştiğinde eski hâli sürüm geçmişinde saklanır.",
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
        )
    }

    if (askDelete && note != null && onDelete != null) {
        DeleteNoteDialog(
            onConfirm = {
                askDelete = false
                onDelete(note.id)
            },
            onDismiss = { askDelete = false },
        )
    }
}

@Composable
private fun StaleVersionWarning(visible: Boolean) {
    if (!visible) return
    ErrorBanner(
        message =
            "Bu notu siz açtıktan sonra başka biri değiştirdi. Kaydederseniz " +
                "çakışma uyarısı alacaksınız; geri dönüp yeniden açmanız önerilir.",
    )
}

@Composable
private fun NoteEditorActions(
    canSave: Boolean,
    isSaving: Boolean,
    canDelete: Boolean,
    onSave: () -> Unit,
    onAskDelete: () -> Unit,
) {
    KlinaraButton(
        title = "Kaydet",
        onClick = onSave,
        enabled = canSave,
        isLoading = isSaving,
        modifier = Modifier.fillMaxWidth(),
    )

    if (canDelete) {
        KlinaraButton(
            title = "Notu sil",
            onClick = onAskDelete,
            kind = KlinaraButtonKind.Tertiary,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun NoteKindCard(
    availableKinds: List<CustomerNoteKind>,
    selected: CustomerNoteKind,
    canWriteMedical: Boolean,
    onSelect: (CustomerNoteKind) -> Unit,
) {
    KlinaraCard(
        title = "Tür",
        footnote =
            if (canWriteMedical) {
                "Tedavi ve iç notlar sağlık verisidir; yalnız klinik yetkisi olanlar görebilir."
            } else {
                "Klinik not yazma yetkiniz yok; yalnız genel not ekleyebilirsiniz."
            },
    ) {
        KlinaraSegmentedPicker(
            options = availableKinds,
            // Yetkisi olmayan biri klinik türü seçili göremez: kaydederken 403 alacağı
            // bir seçimi ona göstermek, yapamayacağı bir şeyi vaat etmek olurdu.
            selected = if (selected in availableKinds) selected else CustomerNoteKind.General,
            onSelect = onSelect,
            title = { it.turkishName },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun NoteHistoryCard(
    note: CustomerNote,
    onOpenRevisions: ((String) -> Unit)?,
) {
    KlinaraCard(title = "Geçmiş") {
        KlinaraRow(label = "Sürüm", value = note.version.toString())
        // Geçmiş düğmesi yalnız DÜZENLENMİŞ notta: sürüm 1'de açılacak bir şey yok ve
        // boş bir liste göstermek, kullanıcıya olmayan bir geçmişi aratmak olurdu.
        if (note.wasEdited && onOpenRevisions != null) {
            KlinaraButton(
                title = "Düzenleme geçmişini gör",
                onClick = { onOpenRevisions(note.id) },
                kind = KlinaraButtonKind.Tertiary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun DeleteNoteDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Not silinsin mi?", style = KlinaraType.titleM) },
        text = {
            Text(
                "Not arşivlenir ve kartta görünmez. Sürüm geçmişi saklanmaya devam eder.",
                style = KlinaraType.bodyM,
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Sil") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Vazgeç") } },
        containerColor = KlinaraTheme.colors.surfaceRaised,
    )
}

/** Revizyon listesi — salt okunur. */
@Composable
fun NoteRevisionsScreen(
    current: CustomerNote?,
    revisions: List<com.klinara.android.services.crm.CustomerNoteRevision>,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    formatDate: (java.time.Instant) -> String = { it.toString() },
) {
    val colors = KlinaraTheme.colors

    KlinaraScreen(title = "Düzenleme geçmişi", modifier = modifier, onBack = onBack) {
        current?.let {
            KlinaraCard(title = "Şu anki metin", footnote = "Sürüm ${it.version}") {
                Text(text = it.body, style = KlinaraType.bodyM, color = colors.charcoal)
            }
        }

        if (revisions.isEmpty()) {
            Text(
                text = "Bu notun metni hiç değiştirilmemiş.",
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
            )
            return@KlinaraScreen
        }

        // ⚠️ Revizyon gövdesi düzenlemeden ÖNCEKİ metindir. Başlıkta bunu söylemek,
        // kullanıcının yanlış metni geri almasını önler.
        Text(
            text = "Aşağıdaki metinler, o sürümde kaydedilmeden ÖNCEKİ hâllerdir.",
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
        )

        Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
            revisions.forEach { revision ->
                KlinaraCard(
                    title = "Sürüm ${revision.version}",
                    footnote = revision.editedAt?.let(formatDate),
                ) {
                    Text(text = revision.body, style = KlinaraType.bodyM, color = colors.charcoal)
                }
            }
        }
    }
}
