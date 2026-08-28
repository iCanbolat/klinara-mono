import Foundation

/// Günün saati — `HH:mm`.
///
/// **Neden ayrı bir tip:** sunucu bu alanları `"09:00:00"` biçiminde DÖNDÜRÜR
/// ama `"09:00"` biçiminde BEKLER (`scheduling.dto.ts` → `TIME_PATTERN`
/// saniye içermez). İki biçim arasındaki dönüşüm dört ekranda ayrı ayrı
/// yapılırsa biri er ya da geç saniyeyi geri göndermeyi dener ve
/// `400 VALIDATION_FAILED` alır.
struct ClockTime: Sendable, Equatable, Comparable, Hashable {

    let hour: Int
    let minute: Int

    init(hour: Int, minute: Int) {
        self.hour = min(max(hour, 0), 23)
        self.minute = min(max(minute, 0), 59)
    }

    /// `"09:00"` ve `"09:00:00"` — ikisini de kabul eder.
    init?(_ raw: String?) {
        guard let raw else { return nil }
        let parts = raw.split(separator: ":")
        guard parts.count >= 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else {
            return nil
        }
        self.init(hour: hour, minute: minute)
    }

    /// Sunucuya gönderilen biçim — saniyesiz.
    var wireValue: String { String(format: "%02d:%02d", hour, minute) }

    /// Kullanıcıya gösterilen biçim. Türkiye'de 24 saat kullanılır, dolayısıyla
    /// tel biçimiyle aynı; yine de ayrı bir isim, ikisinin bağımsız
    /// değişebileceğini söyler.
    var displayValue: String { wireValue }

    var minutesFromMidnight: Int { hour * 60 + minute }

    static func < (lhs: ClockTime, rhs: ClockTime) -> Bool {
        lhs.minutesFromMidnight < rhs.minutesFromMidnight
    }

    /// Mock servisin sunucuyla aynı biçimi üretmesi için: `"09:00"` → `"09:00:00"`.
    static func serverFormatted(_ raw: String?) -> String? {
        guard let time = ClockTime(raw) else { return nil }
        return String(format: "%02d:%02d:00", time.hour, time.minute)
    }

    static let nineAM = ClockTime(hour: 9, minute: 0)
    static let sixPM = ClockTime(hour: 18, minute: 0)
}

/// Şube saat dilimindeki tarih/saat işlemleri.
///
/// **Faz 2'nin en kolay hata yapılan yeri.** Sunucu her şeyi UTC saklar ve
/// istisna kayıtlarını ISO 8601 olarak alır; kullanıcı ise şube saatinde
/// düşünür ("Salı 14:00'te izinli"). Cihazın saat dilimini varsaymak, seyahat
/// eden bir yöneticinin izni yanlış saate yazması demektir — ve yaz saati
/// geçişinde bu, cihaz doğru saat diliminde olsa bile olur.
struct BranchClock: Sendable {

    let timeZone: TimeZone
    private let calendar: Calendar

    init(timeZoneIdentifier: String?) {
        // Bilinmeyen kimlikte UTC'ye düşmek sessiz ama açıklanabilir bir hata
        // üretir; cihaz saatine düşmek ise kullanıcıya göre değişen, tekrar
        // üretilemeyen bir hata üretirdi.
        let resolved = timeZoneIdentifier.flatMap(TimeZone.init(identifier:))
            ?? TimeZone(identifier: "Europe/Istanbul")
            ?? .gmt
        timeZone = resolved

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = resolved
        calendar.locale = Locale(identifier: "tr_TR")
        // Türkiye'de takvim haftası pazartesi başlar.
        calendar.firstWeekday = 2
        self.calendar = calendar
    }

    init(branch: BranchSummary?) {
        self.init(timeZoneIdentifier: branch?.timezone)
    }

    // MARK: Biçimlendirme

    func formatDateTime(_ date: Date) -> String {
        formatter(dateStyle: .medium, timeStyle: .short).string(from: date)
    }

    func formatDate(_ date: Date) -> String {
        formatter(dateStyle: .medium, timeStyle: .none).string(from: date)
    }

    func formatTime(_ date: Date) -> String {
        formatter(dateStyle: .none, timeStyle: .short).string(from: date)
    }

    /// "12 Eyl 09:00 – 15 Eyl 18:00", aynı gündeyse "12 Eyl 09:00 – 18:00".
    func formatRange(from start: Date, to end: Date) -> String {
        let sameDay = calendar.isDate(start, inSameDayAs: end)
        return sameDay
            ? "\(formatDateTime(start)) – \(formatTime(end))"
            : "\(formatDateTime(start)) – \(formatDateTime(end))"
    }

    private func formatter(
        dateStyle: DateFormatter.Style,
        timeStyle: DateFormatter.Style
    ) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "tr_TR")
        formatter.timeZone = timeZone
        formatter.dateStyle = dateStyle
        formatter.timeStyle = timeStyle
        return formatter
    }

    // MARK: Tel biçimi

    /// Şube saatinde bir `Date` → sunucuya gidecek ISO 8601 metni.
    ///
    /// `Date` zaten mutlak bir andır; buradaki iş, offset'i **şube saat
    /// diliminde** yazmaktır ki sunucu logunda ve denetim kaydında saat
    /// kliniğin gördüğü saatle eşleşsin.
    func wireValue(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = timeZone
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    /// Bir günün başlangıcına, şube saat diliminde, belirli bir saati yerleştirir.
    func date(on day: Date, at time: ClockTime) -> Date {
        calendar.date(
            bySettingHour: time.hour,
            minute: time.minute,
            second: 0,
            of: day
        ) ?? day
    }

    func startOfDay(_ date: Date) -> Date {
        calendar.startOfDay(for: date)
    }

    func adding(days: Int, to date: Date) -> Date {
        calendar.date(byAdding: .day, value: days, to: date) ?? date
    }

    // MARK: Takvim aritmetiği

    /// `GET /calendar/day?date=` ve `?weekStart=` parametrelerinin biçimi.
    ///
    /// Sunucu burada bir **an** değil, şubenin yerel takvim gününü bekliyor.
    /// Cihaz saatiyle üretmek gece yarısına yakın saatlerde bir gün öteye
    /// kayardı — kullanıcı bugünü açar, dün gelirdi.
    func localDateString(_ date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// `"2026-09-07"` → şube saatinde o günün başlangıcı.
    /// `density[].localDay` ve `birthDate` gibi çıplak tarihleri yorumlar.
    func date(fromLocalDateString raw: String) -> Date? {
        let parts = raw.split(separator: "-")
        guard parts.count == 3,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2])
        else { return nil }
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        return calendar.date(from: components)
    }

    /// Haftanın başlangıcı — `firstWeekday = 2` olduğu için daima **pazartesi**.
    /// Ayın ilk günü, şube saatinde. Rapor aralıkları **yarı açıktır**
    /// (`[from, to)`) ve ay sınırını cihaz takviminde hesaplamak, seyahat eden
    /// bir yöneticiye komşu ayın raporunu gösterirdi.
    func startOfMonth(_ date: Date) -> Date {
        calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
    }

    func adding(months: Int, to date: Date) -> Date {
        calendar.date(byAdding: .month, value: months, to: date) ?? date
    }

    func startOfWeek(_ date: Date) -> Date {
        let interval = calendar.dateInterval(of: .weekOfYear, for: date)
        return interval?.start ?? startOfDay(date)
    }

    /// Verilen tarihin haftasındaki yedi gün, pazartesiden pazara.
    func weekDays(of date: Date) -> [Date] {
        let start = startOfWeek(date)
        return (0..<7).map { adding(days: $0, to: start) }
    }

    func adding(minutes: Int, to date: Date) -> Date {
        calendar.date(byAdding: .minute, value: minutes, to: date) ?? date
    }

    /// İki an arasındaki dakika farkı. Izgarada blok yüksekliği bundan çıkar.
    func minutes(from start: Date, to end: Date) -> Int {
        calendar.dateComponents([.minute], from: start, to: end).minute ?? 0
    }

    /// Şube saatinde gece yarısından itibaren geçen dakika — ızgarada y ofseti.
    ///
    /// `startOfDay`'e göre ölçülür, saat bileşenine göre değil: yaz saati
    /// geçişinde gün 23 ya da 25 saat sürer ve blokların kayması gerekir.
    func minutesFromMidnight(_ date: Date) -> Int {
        minutes(from: startOfDay(date), to: date)
    }

    func isSameDay(_ lhs: Date, _ rhs: Date) -> Bool {
        calendar.isDate(lhs, inSameDayAs: rhs)
    }

    func isToday(_ date: Date, now: Date = Date()) -> Bool {
        isSameDay(date, now)
    }
}
