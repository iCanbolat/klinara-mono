package com.klinara.android.services.mock

/**
 * Giriş YOLUNU seçer. Oturum sonrası veriyi [MockDataScenario] seçer; ikisi bağımsızdır.
 *
 * Bu liste doğrudan geliştirici menüsünde görünür (yalnız debug varyantı).
 */
enum class MockScenario(val turkishName: String) {
    HappyPasskey("Passkey ile tek dokunuş"),
    PasswordOnly("Yalnız parola"),
    PasswordThenTotp("Parola + TOTP"),
    MfaRequiredNotConfigured("2FA zorunlu, kurulmamış"),
    MultiTenant("Çok kiracılı"),
    MultiBranch("Çok şubeli"),
    UnverifiedPhone("Telefon doğrulanmamış"),
    WrongPassword("Hatalı parola"),
    AccountLocked("Hesap kilitli"),
    RateLimited("Hız sınırı"),
    NetworkError("Ağ hatası"),
    PractitionerScope("Uygulayıcı kapsamı"),
    ;

    /**
     * Varsayılan `manager`: mock mod yarı erişilemez olmasın. Yalnız
     * [PractitionerScope] dar kapsamı sürer.
     */
    val roleKey: String get() = if (this == PractitionerScope) "practitioner" else "manager"
}

/** Oturum SONRASI veriyi seçer. */
enum class MockDataScenario(val turkishName: String, val detail: String) {
    EmptyDay("Boş gün", "Hiç randevu yok — boş durum metinleri görünür."),
    BusyDay("Yoğun gün", "Tipik bir klinik günü."),
    ConflictHeavy("Çakışma yoğun", "Üst üste binen bloklar ve slot çakışmaları."),
}
