package com.klinara.android.services.auth

import com.klinara.android.services.networking.FakePreferencesDataStore
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/**
 * `TokenStore`'un MANTIĞI. Gerçek `KeystoreSessionCipher` burada test EDİLMEZ —
 * `AndroidKeyStore` JVM'de yok ve Robolectric'in gölgesi eksik; onun kapsadığını
 * varsaymak kendi token'ını okuyamayan bir uygulama yayınlamanın yoludur. O,
 * ayrı bir instrumented testte cihazda doğrulanır.
 */
class TokenStoreTest {
    private fun store(
        cipher: InMemorySessionCipher = InMemorySessionCipher(),
        clock: Clock = Clock.systemUTC(),
    ) = TokenStore(FakePreferencesDataStore(), cipher, clock)

    private fun tokens(
        access: String = "access-1",
        refresh: String = "refresh-1",
        expiresIn: Long = 900,
    ) = AuthTokens(accessToken = access, refreshToken = refresh, expiresIn = expiresIn)

    @Test
    @DisplayName("Kaydedilen oturum geri okunur ve cache ısınır")
    fun savedSessionRoundTrips() =
        runTest {
            val store = store()
            store.save(tokens(), tenantId = "tenant-a")

            assertTrue(store.hasSession())
            assertEquals("access-1", store.accessToken())
            assertEquals("refresh-1", store.refreshToken())
            assertEquals("tenant-a", store.tenantId())
            // İnterceptor bloklayıcı okur; cache ısınmış olmalı.
            assertEquals("access-1", store.cachedAccessToken())
        }

    @Test
    @DisplayName("Yenileme mevcut şube ve kiracı kapsamını KORUR")
    fun refreshPreservesBranchAndTenantScope() =
        runTest {
            val store = store()
            store.save(tokens(), tenantId = "tenant-a")
            store.setBranch("branch-nisantasi")

            store.save(tokens(access = "access-2", refresh = "refresh-2"))

            assertEquals("access-2", store.accessToken())
            assertEquals(
                "branch-nisantasi",
                store.branchId(),
                "Yenileme sonrası şube kapsamının sıfırlanması kullanıcıyı sebepsiz şube seçimine düşürür",
            )
            assertEquals("tenant-a", store.tenantId())
        }

    @Test
    @DisplayName("setBranch token'ları EZMEZ")
    fun setBranchDoesNotClobberTokens() =
        runTest {
            val store = store()
            store.save(tokens())
            store.setBranch("branch-x")

            assertEquals("access-1", store.accessToken())
            assertEquals("branch-x", store.branchId())
            assertEquals("branch-x", store.cachedBranchId())
        }

    @Test
    @DisplayName("needsRefresh sınırı tam 60 saniye")
    fun refreshWindowIsExactlySixtySeconds() =
        runTest {
            val now = Instant.parse("2026-09-09T10:00:00Z")

            // 90 sn ömür: 60 sn penceresinin dışında.
            val roomy = store(clock = Clock.fixed(now, ZoneOffset.UTC))
            roomy.save(tokens(expiresIn = 90))
            assertFalse(roomy.needsRefresh(), "90 sn kalmışken yenilenmemeli")

            // 59 sn ömür: pencere içinde.
            val tight = store(clock = Clock.fixed(now, ZoneOffset.UTC))
            tight.save(tokens(expiresIn = 59))
            assertTrue(tight.needsRefresh(), "60 sn'den az kalmışken yenilenmeli")
        }

    @Test
    @DisplayName("Oturum yokken needsRefresh false — yenilenecek bir şey yok")
    fun noSessionMeansNoRefresh() =
        runTest {
            assertFalse(store().needsRefresh())
        }

    @Test
    @DisplayName("clear her şeyi siler ve anahtarı yok eder")
    fun clearWipesEverything() =
        runTest {
            val cipher = InMemorySessionCipher()
            val store = store(cipher)
            store.save(tokens())
            store.clear()

            assertFalse(store.hasSession())
            assertNull(store.accessToken())
            assertNull(store.cachedAccessToken())
            assertEquals(1, cipher.destroyCount, "Anahtar da yok edilmeli, blob'u silmek yetmez")
        }

    @Test
    @DisplayName("Çözememek ÇIKIŞ YAPMAK demektir, asla çökmek değil")
    fun undecryptableBlobDegradesToLoggedOut() =
        runTest {
            val cipher = InMemorySessionCipher()
            val dataStore = FakePreferencesDataStore()
            val writer = TokenStore(dataStore, cipher)
            writer.save(tokens())

            // Cihaz geri yükleme / OEM firmware hatası / .debug-release çakışması:
            // Keystore anahtarı geçersizleşti.
            cipher.corrupted = true
            val reader = TokenStore(dataStore, cipher)

            assertNull(reader.accessToken(), "Açılamayan blob 'çıkış yapılmış' demektir")
            assertFalse(reader.hasSession())
            assertTrue(cipher.destroyCount >= 1, "Açılamayan anahtar yok edilmeli")

            // Ve depo gerçekten temizlenmiş olmalı: sonraki okuma da sessizce null.
            assertNull(TokenStore(dataStore, InMemorySessionCipher()).accessToken())
        }

    @Test
    @DisplayName("Soğuk cache: interceptor Authorization göndermez, istek 401'e düşer")
    fun coldCacheYieldsNoAuthorizationHeader() =
        runTest {
            val cipher = InMemorySessionCipher()
            val dataStore = FakePreferencesDataStore()
            TokenStore(dataStore, cipher).save(tokens())

            // Yeni örnek: diskte oturum var ama bellek cache'i henüz soğuk.
            val fresh = TokenStore(dataStore, cipher)
            assertNull(
                fresh.cachedAccessToken(),
                "Isınmamış cache null döner; interceptor Authorization eklemez ve istek 401'e düşer",
            )

            fresh.warmUp()
            assertEquals("access-1", fresh.cachedAccessToken())
        }
}
