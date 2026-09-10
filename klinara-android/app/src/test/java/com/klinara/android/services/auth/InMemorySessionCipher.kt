package com.klinara.android.services.auth

import java.security.GeneralSecurityException

/**
 * Test ikizi.
 *
 * `AndroidKeyStore` JVM'de yoktur ve Robolectric'in gölgesi eksiktir. `TokenStore`'un
 * MANTIĞI (yenileme penceresi, şube korunumu, çözememe → çıkış) burada test edilir;
 * gerçek `KeystoreSessionCipher` ayrı bir instrumented testte cihazda doğrulanır.
 * Robolectric'in Keystore'u kapsadığını varsaymak, kendi token'ını okuyamayan bir
 * uygulama yayınlamanın yoludur.
 */
internal class InMemorySessionCipher(
    /** true olduğunda [open] gerçek bir Keystore geçersizleşmesini taklit eder. */
    var corrupted: Boolean = false,
) : SessionCipher {
    var destroyCount: Int = 0
        private set

    override fun seal(plain: ByteArray): ByteArray = MAGIC + plain

    override fun open(blob: ByteArray): ByteArray {
        if (corrupted) throw GeneralSecurityException("test: anahtar geçersiz")
        require(blob.size >= MAGIC.size && blob.take(MAGIC.size) == MAGIC.toList()) {
            "test: blob bozuk"
        }
        return blob.copyOfRange(MAGIC.size, blob.size)
    }

    override fun destroy() {
        destroyCount++
        corrupted = false
    }

    private companion object {
        val MAGIC = byteArrayOf(0x4B, 0x4C, 0x4E, 0x00)
    }
}
