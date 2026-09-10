package com.klinara.android

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * A0.1 duman testi: derleme hattının ve JUnit 5 platformunun ayakta olduğunu kanıtlar.
 * Asıl testler A0.4'ten itibaren gelir.
 */
class ScaffoldSmokeTest {
    @Test
    @DisplayName("Taban URL /api/v1 önekini zaten içerir")
    fun baseUrlCarriesApiPrefix() {
        val baseUrl = BuildConfig.KLINARA_API_BASE_URL
        assertTrue(baseUrl.isNotBlank(), "Taban URL boş olamaz")
        assertTrue(
            baseUrl.endsWith("/api/v1"),
            "iOS Info.plist paritesi: taban URL /api/v1 ile bitmeli, ApiRequest.path öneksiz kalsın — $baseUrl",
        )
    }

    @Test
    @DisplayName("Debug derlemesinde düz metin yalnız yerel adreslere açıktır")
    fun debugBaseUrlIsLocalOnly() {
        val baseUrl = BuildConfig.KLINARA_API_BASE_URL
        if (baseUrl.startsWith("http://")) {
            val host = baseUrl.removePrefix("http://").substringBefore(':').substringBefore('/')
            assertTrue(
                host in setOf("10.0.2.2", "localhost", "127.0.0.1"),
                "network_security_config yalnız bu üç konağa izin veriyor, taban URL uyuşmuyor: $host",
            )
        } else {
            assertFalse(baseUrl.startsWith("http://"), "Beklenmeyen şema")
        }
    }
}
