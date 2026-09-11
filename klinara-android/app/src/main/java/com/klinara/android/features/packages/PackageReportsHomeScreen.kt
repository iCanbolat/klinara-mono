package com.klinara.android.features.packages

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraScreen

/**
 * Paket raporlarının girişi (A5.4).
 *
 * Üç rapor üç ayrı soruyu cevaplıyor: **ne kadar borçluyuz** (yükümlülük), **ne zaman
 * yanacak** (süre dolumu), **dönemde ne oldu** (kullanım). Tek ekranda birleştirmek üçünü
 * de okunmaz kılardı.
 *
 * Yükümlülük satırı `report.revenue:read` yoksa **hiç çizilmez** ve bunun sebebi yazılır:
 * "yok" ile "göremiyorsun" arasındaki fark — rapor burada eksik değil, kapalı.
 */
@Composable
fun PackageReportsHomeScreen(
    canReadRevenue: Boolean,
    onOpenOutstanding: () -> Unit,
    onOpenExpiring: () -> Unit,
    onOpenUsage: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    KlinaraScreen(title = "Paket raporları", modifier = modifier, onBack = onBack) {
        KlinaraCard(footnote = "Tutarlar satış anındaki tahsisten hesaplanır, güncel katalog fiyatından değil.") {
            if (canReadRevenue) {
                KlinaraNavigationRow(
                    label = "Taşınan yükümlülük",
                    detail = "Satılmış ama kullanılmamış seansların parasal karşılığı",
                    onClick = onOpenOutstanding,
                )
                KlinaraDivider()
            }
            KlinaraNavigationRow(
                label = "Yaklaşan süre dolumu",
                detail = "Seçilen dönemde süresi dolacak paketler",
                onClick = onOpenExpiring,
            )
            KlinaraDivider()
            KlinaraNavigationRow(
                label = "Dönem kullanımı",
                detail = "Satılan, tüketilen, iade ve süre dolumu",
                onClick = onOpenUsage,
            )
        }
        if (!canReadRevenue) {
            Text(
                "Parasal raporlar bu rolde görüntülenemez; süre dolumu raporunda tutarlar gizlenir.",
                style = KlinaraType.bodyM,
                color = KlinaraTheme.colors.charcoalMuted,
            )
        }
    }
}
