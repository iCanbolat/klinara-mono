package com.klinara.android.services.reports

import kotlin.math.abs

/**
 * Sunucunun `reporting/csv.ts` + `report-csv.ts`'inin mock aynası: aynı başlıklar, `;` ayraç,
 * UTF-8 BOM, `\r\n`, ondalıkta virgül, parada iki sütun (insan için `12,34`, makine için kuruş).
 * Excel için yazılmış bir dosya; RFC 4180 değil.
 */
internal object MockReportCsv {
    fun occupancy(report: OccupancyReport): String =
        csv(
            listOf("Kırılım", "Dolu dakika", "Müsait dakika", "Doluluk %"),
            report.data.map {
                listOf(it.groupLabel, "${it.bookedMinutes}", "${it.availableMinutes}", decimal(it.occupancyRate))
            },
        )

    fun revenue(report: RevenueReport): String =
        csv(
            listOf("Kırılım", "Ciro", "Ciro (kuruş)", "Para birimi"),
            report.data.map {
                listOf(it.groupLabel, money(it.accruedMinor), "${it.accruedMinor}", report.totals.currency)
            },
        )

    fun staffPerformance(report: StaffPerformanceReport): String =
        csv(
            listOf(
                "Personel",
                "Tamamlanan işlem",
                "Ciro",
                "Ciro (kuruş)",
                "Dolu dakika",
                "Müsait dakika",
                "Doluluk %",
            ),
            report.data.map {
                listOf(
                    it.staffName,
                    "${it.completedServices}",
                    money(it.revenueMinor),
                    "${it.revenueMinor}",
                    "${it.bookedMinutes}",
                    "${it.availableMinutes}",
                    decimal(it.occupancyRate),
                )
            },
        )

    fun noShow(report: NoShowReport): String =
        csv(
            listOf("Kırılım", "Toplam", "Tamamlanan", "Gelmedi", "İptal", "Gelmeme %", "İptal %"),
            report.data.map {
                listOf(
                    it.groupLabel,
                    "${it.total}",
                    "${it.completed}",
                    "${it.noShow}",
                    "${it.cancelled}",
                    decimal(it.noShowRate),
                    decimal(it.cancellationRate),
                )
            },
        )

    /** Kazanımın CSV'si yalnız kaynak kırılımı — kohortlar ekranda kalır (sunucu kararı). */
    fun retention(report: RetentionReport): String =
        csv(
            listOf("Geliş kaynağı", "Müşteri"),
            report.acquisition.map { listOf(it.source ?: "Belirtilmemiş", "${it.customers}") },
        )

    private fun csv(
        headers: List<String>,
        rows: List<List<String>>,
    ): String {
        val lines = (listOf(headers) + rows).map { row -> row.joinToString(DELIMITER, transform = ::field) }
        return BOM + lines.joinToString(LINE_END) + LINE_END
    }

    /** Tırnak, ayraç ve satır sonu içeren alan tırnaklanır; içerideki tırnak ikilenir. */
    private fun field(value: String): String =
        if (value.any { it in NEEDS_QUOTES }) "\"${value.replace("\"", "\"\"")}\"" else value

    /** JS `String(n).replace('.', ',')` — `0` → `"0"`, `5.56` → `"5,56"`. */
    private fun decimal(value: Double): String {
        val whole = value == Math.floor(value) && !value.isInfinite()
        val text = if (whole) value.toLong().toString() else value.toString()
        return text.replace('.', ',')
    }

    /** Float'a uğramadan: `1234` → `"12,34"`. */
    private fun money(minor: Long): String {
        val digits = abs(minor).toString().padStart(FRACTION_DIGITS + 1, '0')
        val whole = digits.dropLast(FRACTION_DIGITS)
        val fraction = digits.takeLast(FRACTION_DIGITS)
        return "${if (minor < 0) "-" else ""}$whole,$fraction"
    }

    private const val BOM = "\uFEFF"
    private const val DELIMITER = ";"
    private const val LINE_END = "\r\n"
    private val NEEDS_QUOTES = setOf('"', ';', '\r', '\n')
    private const val FRACTION_DIGITS = 2
}
