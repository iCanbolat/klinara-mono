package com.klinara.android.features.reports

import androidx.compose.foundation.layout.RowScope
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.services.reports.ReportKind

/** Giriş satırının metni — iOS `ReportsHomeView` ile aynı. */
internal val ReportKind.title: String
    get() =
        when (this) {
            ReportKind.Occupancy -> "Doluluk"
            ReportKind.Revenue -> "Ciro"
            ReportKind.StaffPerformance -> "Personel performansı"
            ReportKind.NoShow -> "Gelmeme ve iptal"
            ReportKind.Retention -> "Kazanım ve geri dönüş"
        }

private val ReportKind.detail: String
    get() =
        when (this) {
            ReportKind.Occupancy -> "Müsait dakikaların ne kadarı dolu"
            ReportKind.Revenue -> "Tamamlanan hizmet ve paket satışlarının bedeli"
            ReportKind.StaffPerformance -> "İşlem, ciro ve doluluk"
            ReportKind.NoShow -> "Randevu başına gelmeme ve iptal oranı"
            ReportKind.Retention -> "Yeni müşteri, geri gelen ve geliş kaynağı"
        }

/**
 * Klinik raporlarının girişi (A9). Satırlar [ReportAccess] ile süzülür: resepsiyon ciro iznini,
 * uygulayıcı genel raporları taşımıyor — ikisi farklı satır kümesi görür. Görülemeyen rapor
 * ÇİZİLMEZ; ciro kapalıysa bunun sebebi yazılır ("yok" ile "göremiyorsun" farkı).
 */
@Composable
fun ReportsHomeScreen(
    visible: List<ReportKind>,
    onOpen: (ReportKind) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    KlinaraScreen(title = "Raporlar", modifier = modifier, onBack = onBack, trailing = trailing) {
        KlinaraCard(footnote = "Dönem aralığı yarı açıktır: bitiş günü dahil değildir.") {
            visible.forEachIndexed { index, kind ->
                if (index > 0) KlinaraDivider()
                KlinaraNavigationRow(label = kind.title, detail = kind.detail, onClick = { onOpen(kind) })
            }
        }
        if (ReportKind.Revenue !in visible) {
            ReportNote("Ciro raporu bu rolde görüntülenemez.")
        }
    }
}
