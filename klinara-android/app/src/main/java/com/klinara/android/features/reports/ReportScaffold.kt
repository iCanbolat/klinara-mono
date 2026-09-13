package com.klinara.android.features.reports

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraChartKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.designsystem.components.ReportPeriodBar
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.reports.ReportKind
import com.klinara.android.services.reports.ReportScope

/** Rapor ekranlarının ortak etiketleri — ViewModel'in saatiyle kurulur, ekran tarih bilmez. */
data class ReportLabels(
    /** Kapsayıcı: "1 Eylül 2026 – 30 Eylül 2026". */
    val period: String,
    /** Karşılaştırılan AYNI UZUNLUKTAKİ önceki pencere. */
    val previous: String,
)

/** Beş rapor ekranının ortak eylemleri. */
data class ReportActions(
    val onShift: (Long) -> Unit,
    val onCompareChange: (Boolean) -> Unit,
    val onRetry: () -> Unit,
    val onLoadMore: () -> Unit,
    val onExport: () -> Unit,
    val onDismissExport: () -> Unit,
    val onBack: () -> Unit,
)

/**
 * Rapor ekranı iskeleti: dönem çubuğu, (varsa) karşılaştırma anahtarı, sonra yükleme durumuna
 * göre içerik. Beş ekran aynı sırayı ve aynı hata/boş davranışını taşısın diye tek yerde.
 *
 * Dönem çubuğu ve anahtar yükleme sırasında da yerinde durur: kullanıcı yavaş bir ağda bir
 * sonraki aya geçmek için yanıtı beklemek zorunda kalmamalı.
 */
@Composable
@Suppress("LongParameterList")
internal fun <T> ReportScaffold(
    title: String,
    report: Loadable<T>,
    labels: ReportLabels,
    actions: ReportActions,
    isEmpty: (T) -> Boolean,
    empty: ReportEmpty,
    kind: ReportKind,
    export: ExportState,
    /** `null` → rapor karşılaştırma desteklemiyor (personel performansı), anahtar çizilmez. */
    compareToPrevious: Boolean?,
    modifier: Modifier = Modifier,
    controls: @Composable ColumnScope.() -> Unit = {},
    content: @Composable ColumnScope.(T) -> Unit,
) {
    KlinaraScreen(title = title, modifier = modifier, onBack = actions.onBack) {
        ReportPeriodBar(label = labels.period, onShift = actions.onShift)
        if (compareToPrevious != null) {
            KlinaraCard {
                KlinaraToggleRow(
                    label = "Önceki dönemle karşılaştır",
                    isOn = compareToPrevious,
                    onToggle = actions.onCompareChange,
                    detail =
                        if (compareToPrevious) {
                            "Karşılaştırılan: ${labels.previous} — aynı uzunlukta, hemen önceki dönem"
                        } else {
                            "Aynı uzunlukta, hemen önceki dönemle yüzde değişim"
                        },
                )
            }
        }
        controls()
        when (report) {
            Loadable.Loading ->
                Text(
                    "Yükleniyor…",
                    style = KlinaraType.bodyM,
                    color = KlinaraTheme.colors.charcoalMuted,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            is Loadable.Failed ->
                ErrorBanner(message = report.message, onRetry = actions.onRetry.takeIf { report.isRetryable })
            is Loadable.Loaded ->
                if (isEmpty(report.value)) {
                    EmptyStateView(title = empty.title, message = empty.message, icon = empty.icon)
                } else {
                    content(report.value)
                    ReportExportSection(export = export, kind = kind, actions = actions)
                }
        }
    }
}

/**
 * CSV dışa aktarım. Dosya **kullanıcının seçtiği konuma** yazılır (SAF); uygulama kendi dizinine
 * sağlık/ciro verisi yazmaz ve baytlar kaydedildikten sonra bellekte tutulmaz.
 *
 * Düğme yalnız veri VARKEN görünür: boş bir raporun başlıktan ibaret CSV'si kimseye lazım değil.
 */
@Composable
private fun ReportExportSection(
    export: ExportState,
    kind: ReportKind,
    actions: ReportActions,
) {
    export.error?.let { message ->
        ErrorBanner(message = message, retryLabel = "Tamam", onRetry = actions.onDismissExport)
    }
    export.savedName?.let { name ->
        ReportNote("CSV kaydedildi: $name")
    }
    KlinaraButton(
        title = "CSV olarak dışa aktar",
        onClick = actions.onExport,
        kind = KlinaraButtonKind.Secondary,
        isLoading = export.preparing == kind,
        modifier = Modifier.fillMaxWidth(),
    )
    ReportNote("Dosya, seçtiğiniz konuma yazılır; uygulama sağlık ya da ciro verisini kendi içinde saklamaz.")
}

data class ReportEmpty(
    val title: String,
    val message: String,
    val icon: ImageVector = Icons.Filled.DateRange,
)

/**
 * Sunucunun daralttığı kapsamı kullanıcıya SÖYLER. `scope` yanıttan geliyor, istemcinin izin
 * listesinden çıkarılmıyor: iki taraf kuralı ayrı yorumlasaydı sunucu daraltırken ekran "tüm
 * klinik" diye başlık atabilirdi.
 */
@Composable
internal fun ReportScopeNotice(scope: ReportScope) {
    if (scope != ReportScope.Own) return
    KlinaraCard {
        Text(
            "Yalnız kendi verileriniz gösteriliyor — rolünüz bu raporu kendi satırınızla sınırlıyor.",
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.charcoal,
        )
    }
}

/**
 * Sonraki sayfa. Sonsuz kaydırma değil düğme (A5.4 kararı): `KlinaraScreen`'in kaydırılabilir
 * sütunu görünürlük tetikleyicisi vermiyor. Toplamlar sayfa eklendikçe DEĞİŞMEZ.
 */
@Composable
internal fun ReportLoadMore(
    canLoadMore: Boolean,
    isLoading: Boolean,
    onLoadMore: () -> Unit,
) {
    if (!canLoadMore && !isLoading) return
    KlinaraButton(
        title = "Sonraki sayfa",
        onClick = onLoadMore,
        kind = KlinaraButtonKind.Tertiary,
        isLoading = isLoading,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Gün kırılımı çizgi (zaman), diğerleri çubuk (kategori). */
internal fun chartKind(isDaily: Boolean): KlinaraChartKind =
    if (isDaily) KlinaraChartKind.Line else KlinaraChartKind.Bar

/** Grafik x etiketi: gün kırılımında kısa tarih ("1 Eyl"), diğerlerinde sunucunun etiketi. */
internal fun chartLabel(
    raw: String,
    isDaily: Boolean,
): String = if (isDaily) ReportFormat.dayShort(raw) else raw

/**
 * Kuruş → lira, YALNIZ grafik ekseni için (`Double` çizim koordinatı). Tutar metinleri `Money`
 * ile `Long`'dan yazılır; burada hesaplanan hiçbir sayı kullanıcıya metin olarak gösterilmez.
 */
internal fun majorUnits(minor: Long): Double = minor / MINOR_PER_MAJOR

private const val MINOR_PER_MAJOR = 100.0

/** Her ekranın altındaki açıklama metni — kartın dışında, soluk. */
@Composable
internal fun ReportNote(text: String) {
    Text(text, style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
}
