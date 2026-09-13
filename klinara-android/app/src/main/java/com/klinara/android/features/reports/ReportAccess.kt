package com.klinara.android.features.reports

import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.reports.ReportKind

/**
 * Hangi rapor hangi izinle açılır — sunucudaki `@RequirePermission`/`@RequireAnyPermission`'ın
 * aynası ve **saf** (izin sorgusu → karar), rol matrisi birim testiyle doğrulanıyor.
 *
 * İzinler rapor rapor ayrı (sunucu kararı): doluluk ve gelmeme OPERASYONEL sayılar ve
 * resepsiyon görmeli; ciro görmemeli. Görülemeyen rapor giriş ekranında HİÇ çizilmez —
 * tıklanamayacak bir satır sunmak, göstermemekten kötü (iOS `ReportsHomeView` kararı).
 */
object ReportAccess {
    fun canOpen(
        kind: ReportKind,
        can: (String) -> Boolean,
    ): Boolean =
        when (kind) {
            ReportKind.Occupancy ->
                can(Permissions.APPOINTMENT_READ_ALL) || can(Permissions.REPORT_PERFORMANCE_READ_OWN)
            ReportKind.Revenue -> can(Permissions.REPORT_REVENUE_READ)
            ReportKind.StaffPerformance ->
                can(Permissions.REPORT_REVENUE_READ) || can(Permissions.REPORT_PERFORMANCE_READ_OWN)
            ReportKind.NoShow, ReportKind.Retention -> can(Permissions.APPOINTMENT_READ_ALL)
        }

    /** Giriş ekranının satırları — iOS sırasıyla. */
    fun visible(can: (String) -> Boolean): List<ReportKind> = ReportKind.entries.filter { canOpen(it, can) }
}
