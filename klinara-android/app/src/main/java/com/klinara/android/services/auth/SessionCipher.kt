package com.klinara.android.services.auth

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Oturum blob'unu mühürler/açar. Test için bellek içi bir uygulaması vardır. */
internal interface SessionCipher {
    fun seal(plain: ByteArray): ByteArray

    fun open(blob: ByteArray): ByteArray

    fun destroy()
}

private const val KEY_ALIAS = "klinara.session.v1"
private const val KEYSTORE = "AndroidKeyStore"
private const val TRANSFORMATION = "AES/GCM/NoPadding"
private const val IV_BYTES = 12
private const val TAG_BITS = 128
private const val KEY_SIZE = 256

/**
 * Android Keystore ile AES-256-GCM.
 *
 * `androidx.security-crypto` **deprecated** olduğu için Keystore'a doğrudan
 * yaslanılıyor; bu hem desteklenen hem de iOS Keychain davranışına en yakın yol.
 *
 * **StrongBox kullanılmaz.** API 28+ olduğu için minSdk 26'yı gerekçelendiremez ve
 * tehdit modelimize (dosyanın çevrimdışı çıkarılması) karşı TEE destekli AES zaten
 * yeterli. Karşılığında birçok OEM'de `StrongBoxUnavailableException`, küçük anahtar
 * yuvaları ve yavaş anahtar üretimi getirirdi.
 */
internal class KeystoreSessionCipher : SessionCipher {
    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
            .apply {
                init(
                    KeyGenParameterSpec
                        .Builder(
                            KEY_ALIAS,
                            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(KEY_SIZE)
                        // Keychain kAfterFirstUnlock paritesi: arka planda token
                        // yenileme, kullanıcı kimlik doğrulaması beklemeden çalışmalı.
                        .setUserAuthenticationRequired(false)
                        // IV'yi ASLA biz seçmeyiz — GCM'de IV tekrarı anahtarı kırar.
                        // Bu bayrak kendi IV'nizi vermeyi aktif olarak yasaklar.
                        .setRandomizedEncryptionRequired(true)
                        .build(),
                )
            }.generateKey()
    }

    override fun seal(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        // Sağlayıcının ürettiği 12 baytlık IV ciphertext'in başına eklenir.
        return cipher.iv + cipher.doFinal(plain)
    }

    override fun open(blob: ByteArray): ByteArray {
        require(blob.size > IV_BYTES) { "Blob çok kısa" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, blob, 0, IV_BYTES))
        return cipher.doFinal(blob, IV_BYTES, blob.size - IV_BYTES)
    }

    override fun destroy() {
        KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(KEY_ALIAS)
    }
}
