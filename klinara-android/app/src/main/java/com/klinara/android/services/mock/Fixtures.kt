package com.klinara.android.services.mock

/**
 * Paylaşılan JSON fixture'larını okur.
 *
 * Java kaynağı olarak paketlendikleri için hem birim test classpath'inde hem debug
 * APK'de aynı yol çalışır; `Context` gerekmez. Kaynak dizin `klinara-fixtures/` —
 * iOS test hedefi de (takip işi) aynı dosyaları okuyacak, böylece R6 (fixture
 * çoğaltması) gerçekten çözülür.
 */
object Fixtures {
    fun read(path: String): String =
        Fixtures::class.java
            .getResourceAsStream("/$path")
            ?.bufferedReader()
            ?.use { it.readText() }
            ?: error("Fixture bulunamadı: $path (klinara-fixtures/ altında mı?)")
}
