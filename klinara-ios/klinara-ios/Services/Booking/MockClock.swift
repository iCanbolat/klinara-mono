import Foundation

/// Mock servislerin ortak "şimdi"si.
///
/// Duvar saati yerine sabit bir referans kullanmanın iki nedeni var:
///
/// 1. **Sıra duvar saatine bağlı kalmasın.** Tohum randevular bugünün sabit
///    saatlerine (09:30–16:30) kuruluyor. Yeni yaratılan bir not `Date()`
///    alsaydı, suite sabah çalıştığında notun üstünde henüz gelmemiş bir
///    randevu durur, akşam çalıştığında durmazdı — aynı testin sonucu saate
///    göre değişirdi.
/// 2. **Cursor kayıpsız yuvarlansın.** Cursor `createdAt`'i saniye cinsinden
///    metne çevirip geri okuyor; `Date` iç referansı 2001 olduğu için 1970
///    üzerinden gidiş-dönüş kesirli saniyelerde birkaç mikrosaniye kayabiliyor.
///    Kayma sıralama anahtarını bozunca aynı kayıt iki sayfada birden çıkardı.
///    Referans tam saniye, ondan türeyen anlar da tam saniye.
enum MockNow {

    /// Bugünün sonuna yakın sabit bir an: tohum takvim "bugün" kalır ama
    /// mock'ta yaratılan her kayıt o günün randevularının üstünde durur.
    static let reference: Date = {
        let clock = BranchClock(timeZoneIdentifier: MockBookingSeed.timezone)
        let today = clock.startOfDay(Date())
        return clock.date(on: today, at: ClockTime(hour: 23, minute: 30))
    }()

    private static let lock = NSLock()
    private static var tick: TimeInterval = 0

    /// Yaratılan kayda referanstan sonra **artan** bir an verir. Hepsi aynı anı
    /// alsaydı sıralama rastgele uuid'lere düşer, yine oynaklık olurdu.
    static func next() -> Date {
        lock.lock()
        defer { lock.unlock() }
        tick += 1
        return reference.addingTimeInterval(tick)
    }
}
