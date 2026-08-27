import Foundation
import Testing
@testable import klinara_ios

/// Faz 2'den devreden test borcu.
///
/// Para ve saat biçimlendirmesi her ekranda kullanılıyor ama hiç test
/// edilmemişti; bir yuvarlama ya da biçim hatası doğrudan yanlış fiyat veya
/// yanlış saat olarak kaydediliyor.
@Suite("Para ve süre")
struct MoneyTests {

    @Test("Kuruş simgeli biçime çevrilir")
    func formatsMinorUnits() {
        // Ayırıcılar tr_TR'de dar boşluk olabildiği için tam metin yerine
        // ayırt edici parçalar aranıyor.
        let output = Money.format(minor: 150_000)
        #expect(output.contains("1.500"))
        #expect(output.contains("00"))
        #expect(output.contains("₺"))
    }

    @Test("Sembolsüz biçim simge içermez")
    func formatsPlain() {
        #expect(Money.formatPlain(minor: 150_000) == "1.500,00")
        #expect(Money.formatPlain(minor: 5) == "0,05")
    }

    @Test("Türkçe ve İngilizce ondalık yazımların ikisi de ayrıştırılır")
    func parsesBothNotations() {
        #expect(Money.parse("1.500,50") == 150_050)
        #expect(Money.parse("1500.50") == 150_050)
        #expect(Money.parse("1.500,50 ₺") == 150_050)
        #expect(Money.parse("0,05") == 5)
        #expect(Money.parse("1500") == 150_000)
    }

    @Test("Virgülsüz noktalı yazımda ayırıcı basamak sayısına göre çözülür")
    func disambiguatesDotSeparator() {
        // Üç basamak → binlik ayırıcı, bir/iki basamak → ondalık.
        // Ayrım olmadan "1500.50" 150.050,00 ₺ olarak kaydediliyordu.
        #expect(Money.parse("1.500") == 150_000)
        #expect(Money.parse("1.234.567") == 123_456_700)
        #expect(Money.parse("1500.5") == 150_050)
        #expect(Money.parse("0.05") == 5)
    }

    @Test("Ayrıştırılamayan ve negatif girdi nil döner")
    func rejectsInvalidInput() {
        // Sessizce 0 kabul etmek, kullanıcının yazdığından farklı bir fiyat
        // kaydetmenin en kestirme yolu olurdu.
        #expect(Money.parse("") == nil)
        #expect(Money.parse("abc") == nil)
        #expect(Money.parse("-50") == nil)
    }

    @Test("Kuruş bölmesi tam sayı bölmesine düşmez")
    func keepsSubUnitPrecision() {
        // 250_001 kuruş = 2.500,01 ₺. Tamsayı bölmesi son kuruşu düşürürdü.
        #expect(Money.formatPlain(minor: 250_001) == "2.500,01")
    }

    @Test("KDV baz puandan yüzdeye çevrilir")
    func formatsVat() {
        #expect(VatRate.format(basisPoints: 2000) == "%20")
        #expect(VatRate.format(basisPoints: 0) == "%0")
        #expect(VatRate.format(basisPoints: 1050) == "%10,50" || VatRate.format(basisPoints: 1050) == "%10.50")
    }

    @Test("Süre saat ve dakikaya bölünür")
    func formatsDuration() {
        #expect(DurationFormat.format(minutes: 30) == "30 dk")
        #expect(DurationFormat.format(minutes: 60) == "1 sa")
        #expect(DurationFormat.format(minutes: 90) == "1 sa 30 dk")
        #expect(DurationFormat.format(minutes: 0) == "0 dk")
    }
}

@Suite("ClockTime")
struct ClockTimeTests {

    @Test("Sunucunun saniyeli biçimi de saniyesiz biçimi de çözülür")
    func parsesBothWireFormats() {
        // Sunucu `"09:00:00"` DÖNDÜRÜR ama `"09:00"` BEKLER. Asimetri burada
        // tek yerde çözülüyor; ekranların bunu bilmesine gerek yok.
        #expect(ClockTime("09:00") == ClockTime(hour: 9, minute: 0))
        #expect(ClockTime("09:00:00") == ClockTime(hour: 9, minute: 0))
        #expect(ClockTime("13:45:00") == ClockTime(hour: 13, minute: 45))
        #expect(ClockTime(nil) == nil)
        #expect(ClockTime("saat yok") == nil)
    }

    @Test("Gönderilen değerde saniye yoktur")
    func wireValueOmitsSeconds() {
        #expect(ClockTime(hour: 9, minute: 5).wireValue == "09:05")
        #expect(ClockTime(hour: 18, minute: 0).wireValue == "18:00")
    }

    @Test("Mock için ters çevirme saniye ekler")
    func serverFormattedAddsSeconds() {
        #expect(ClockTime.serverFormatted("09:00") == "09:00:00")
        #expect(ClockTime.serverFormatted(nil) == nil)
    }

    @Test("Sınır dışı değerler kırpılır")
    func clampsOutOfRange() {
        #expect(ClockTime(hour: 30, minute: 90) == ClockTime(hour: 23, minute: 59))
        #expect(ClockTime(hour: -5, minute: -1) == ClockTime(hour: 0, minute: 0))
    }

    @Test("Gece yarısından itibaren dakika ve sıralama")
    func ordersByMinutes() {
        #expect(ClockTime(hour: 9, minute: 30).minutesFromMidnight == 570)
        #expect(ClockTime(hour: 9, minute: 0) < ClockTime(hour: 9, minute: 1))
        #expect(ClockTime.nineAM < ClockTime.sixPM)
    }
}

@Suite("Arama metni")
struct SearchTextTests {

    @Test("Türkçe harfler aranırken ASCII karşılığıyla eşleşir")
    func foldsTurkishLetters() {
        // Türkçe klavyesi olmayan (ya da aceleyle yazan) kullanıcı kendi
        // müşterisini bulabilmeli — her iki yön de çalışmalı.
        #expect(SearchText.matches("Ayşe Yılmaz", term: "ayse"))
        #expect(SearchText.matches("Ayşe Yılmaz", term: "yilmaz"))
        #expect(SearchText.matches("Ayşe Yılmaz", term: "YILMAZ"))
        #expect(SearchText.matches("Ayşe Yılmaz", term: "yılmaz"))
        #expect(SearchText.matches("Işıl Güneş", term: "isil"))
        #expect(SearchText.matches("Işıl Güneş", term: "gunes"))
        #expect(SearchText.matches("Çiğdem Öz", term: "cigdem"))
    }

    @Test("Boş terim filtre uygulamaz, alakasız terim eşleşmez")
    func handlesEdges() {
        #expect(SearchText.matches("Ayşe", term: ""))
        #expect(SearchText.matches("Ayşe", term: "   "))
        #expect(!SearchText.matches("Ayşe Yılmaz", term: "mehmet"))
    }

    @Test("Telefon araması biçimlendirmeyi yok sayar")
    func matchesPhoneDigits() {
        #expect(SearchText.matchesDigits("+905321112233", term: "0532 111 22 33"))
        #expect(SearchText.matchesDigits("+905321112233", term: "111 22"))
        #expect(!SearchText.matchesDigits("+905321112233", term: "999"))
        #expect(!SearchText.matchesDigits(nil, term: "532"))
        // Rakamsız terimde telefon eşleşmesi aranmaz.
        #expect(!SearchText.matchesDigits("+905321112233", term: "ayşe"))
    }
}
