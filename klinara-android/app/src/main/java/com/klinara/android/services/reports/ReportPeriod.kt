package com.klinara.android.services.reports

import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * `[from, to)` — yarı açık dönem. Ay raporunda `to` ayın son günü değil, ertesi ayın ilk anı.
 *
 * A5.4'te `services/packages` içinde doğdu; A9'da klinik raporları ikinci tüketici oldu ve buraya
 * taşındı — raporlar paket paketine bağımlı olmasın.
 */
data class ReportPeriod(
    val from: Instant,
    val to: Instant,
) {
    init {
        require(to.isAfter(from)) { "Dönem sonu başlangıçtan sonra olmalı" }
    }

    /**
     * Sunucu `@IsISO8601({ strict: true })` istiyor; UTC `Z` biçimi geçerli ve şube saatine
     * dönüşüm istemcide yapılmış oluyor (dönem sınırları `BranchClock` ile hesaplanıyor).
     */
    internal fun wire(): List<Pair<String, String>> =
        listOf("from" to DateTimeFormatter.ISO_INSTANT.format(from), "to" to DateTimeFormatter.ISO_INSTANT.format(to))
}
