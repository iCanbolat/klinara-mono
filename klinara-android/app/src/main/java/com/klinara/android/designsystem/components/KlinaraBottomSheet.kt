package com.klinara.android.designsystem.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Alttan açılan düzenleme paneli — iOS `KlinaraFormScaffold` sheet'inin karşılığı.
 *
 * **"Bottom sheet yok" kuralı burada bilinçli olarak esnetildi.** Kod tabanında
 * `SellPackageSheet` gibi dosyalar adına rağmen gerçek birer hedef, çünkü bir satış akışını
 * yarım ekrana sıkıştırmak akışı gizler. Kategori/etiket düzenlemesi ise küçük ve sonlu:
 * iki alan, bir anahtar ve bir yıkıcı aksiyon. Bunu `AlertDialog` ile yapmak, yıkıcı
 * aksiyona ("Pasife al") diyalog içinde yer bırakmıyordu — o yüzden aksiyon listeye
 * taşınmış ve satırlar kontrol paneline dönmüştü. Panel, aksiyonu ait olduğu yere geri koyar.
 *
 * Kirli bir taslakla kapatılmaya çalışılırsa [UnsavedChangesDialog] sorar: sheet'i aşağı
 * kaydırmak, iOS'taki `interactiveDismissDisabled` gibi, sessizce veri kaybettirmez.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KlinaraBottomSheet(
    title: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    isDirty: Boolean = false,
    confirmTitle: String? = null,
    canConfirm: Boolean = true,
    isSaving: Boolean = false,
    onConfirm: (() -> Unit)? = null,
    dismissTitle: String = "Vazgeç",
    /** Yıkıcı aksiyon (ör. "Pasife al") — formun altında, kaydetme satırının üstünde. */
    destructiveTitle: String? = null,
    onDestructive: (() -> Unit)? = null,
    /** Yıkıcı aksiyonun sınırını açıklayan not — düğmenin ALTINDA, iOS'taki sırayla. */
    destructiveNote: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = KlinaraTheme.colors
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var isAskingDiscard by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = { if (isDirty) isAskingDiscard = true else onDismiss() },
        modifier = modifier,
        sheetState = sheetState,
        containerColor = colors.surfaceRaised,
        contentColor = colors.charcoal,
        dragHandle = null,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(
                        start = KlinaraMetrics.md,
                        end = KlinaraMetrics.md,
                        top = KlinaraMetrics.lg,
                        bottom = KlinaraMetrics.lg,
                    ),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
        ) {
            Text(title, style = KlinaraType.titleM, color = colors.charcoal)

            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()).weight(1f, fill = false),
                verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
                content = content,
            )

            if (destructiveTitle != null && onDestructive != null) {
                KlinaraButton(
                    title = destructiveTitle,
                    onClick = onDestructive,
                    kind = KlinaraButtonKind.Destructive,
                    enabled = !isSaving,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (destructiveNote != null) {
                    Text(destructiveNote, style = KlinaraType.bodyM, color = colors.charcoalMuted)
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
                KlinaraButton(
                    title = dismissTitle,
                    onClick = { if (isDirty) isAskingDiscard = true else onDismiss() },
                    kind = KlinaraButtonKind.Secondary,
                    enabled = !isSaving,
                    modifier = Modifier.weight(1f),
                )
                if (confirmTitle != null && onConfirm != null) {
                    KlinaraButton(
                        title = confirmTitle,
                        onClick = onConfirm,
                        enabled = canConfirm,
                        isLoading = isSaving,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }

    if (isAskingDiscard) {
        UnsavedChangesDialog(
            onDiscard = {
                isAskingDiscard = false
                onDismiss()
            },
            onCancel = { isAskingDiscard = false },
        )
    }
}
