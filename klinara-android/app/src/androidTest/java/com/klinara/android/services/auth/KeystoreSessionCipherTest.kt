package com.klinara.android.services.auth

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import java.security.GeneralSecurityException

/**
 * Gerçek `AndroidKeyStore` yalnız burada test edilir.
 *
 * `TokenStore`'un mantığı JVM'de `InMemorySessionCipher` ile test ediliyor; Robolectric'in
 * Keystore gölgesinin yeterli olduğunu varsaymak, kendi token'ını okuyamayan bir uygulama
 * yayınlamanın yoludur. Bu yüzden şifreleme bir kez, gerçek cihazda doğrulanıyor.
 */
@RunWith(AndroidJUnit4::class)
class KeystoreSessionCipherTest {
    private val cipher = KeystoreSessionCipher()

    @After
    fun tearDown() {
        runCatching { cipher.destroy() }
    }

    @Test
    fun sealThenOpenRoundTrips() {
        val plain = """{"accessToken":"a","refreshToken":"r"}""".encodeToByteArray()

        val sealed = cipher.seal(plain)

        assertNotEquals("Şifreli blob düz metinle aynı olamaz", plain.toList(), sealed.toList())
        assertArrayEquals(plain, cipher.open(sealed))
    }

    @Test
    fun everySealUsesAFreshIv() {
        val plain = "aynı içerik".encodeToByteArray()

        val first = cipher.seal(plain)
        val second = cipher.seal(plain)

        // setRandomizedEncryptionRequired(true) sağlayıcıyı her seferinde yeni bir IV
        // üretmeye zorlar. GCM'de IV tekrarı anahtarı kırar; bu test o garantiyi sabitler.
        assertNotEquals(
            "Aynı düz metin iki kez aynı şifreli metni vermemeli",
            first.take(IV_BYTES),
            second.take(IV_BYTES),
        )
        assertArrayEquals(plain, cipher.open(first))
        assertArrayEquals(plain, cipher.open(second))
    }

    @Test
    fun openFailsAfterKeyIsDestroyed() {
        val sealed = cipher.seal("gizli".encodeToByteArray())

        cipher.destroy()

        // Anahtar yok edildikten sonra eski blob açılamaz. TokenStore bunu yakalayıp
        // "çıkış yapılmış" hâline düşer, çökmez.
        assertThrows(GeneralSecurityException::class.java) { cipher.open(sealed) }
    }

    @Test
    fun tamperedCiphertextIsRejected() {
        val sealed = cipher.seal("gizli".encodeToByteArray())
        val tampered = sealed.copyOf().also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() }

        // GCM kimlik doğrulama etiketi: değiştirilmiş bir blob sessizce çözülmez.
        assertThrows(GeneralSecurityException::class.java) { cipher.open(tampered) }
    }

    @Test
    fun ivIsPrefixedAtExpectedLength() {
        val sealed = cipher.seal(ByteArray(0))
        assertEquals("GCM IV'si 12 bayt olmalı ve başa eklenmeli", IV_BYTES, sealed.size - GCM_TAG_BYTES)
    }

    private companion object {
        const val IV_BYTES = 12
        const val GCM_TAG_BYTES = 16
    }
}
