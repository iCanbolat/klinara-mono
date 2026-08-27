import Foundation

/// Mock verinin hangi "günü" anlattığı.
///
/// `MockScenario` giriş akışının hangi yoldan gideceğini seçer; bu enum ise
/// oturum açıldıktan **sonraki** veriyi seçer. İkisi bağımsız: yoğun bir
/// takvimi passkey'le de parolayla da açabilmek gerekiyor.
///
/// Geliştirici menüsünden değiştirilir (``DeveloperScenarioList``); seçim
/// oturumu düşürür çünkü mock servisler ``ServiceContainer`` kurulurken
/// tohumlanır.
nonisolated enum MockDataScenario: String, CaseIterable, Identifiable, Sendable {
    /// Hiç randevu yok — boş durum ekranlarının tek görülebildiği yer.
    case emptyDay
    /// Gerçekçi bir gün: dolu sabah, boş öğleden sonra, karışık durumlar.
    case busyDay
    /// Takvim neredeyse kapalı — çakışma ve öneri yollarını denemek için.
    case conflictHeavy

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .emptyDay: return "Boş gün"
        case .busyDay: return "Yoğun gün"
        case .conflictHeavy: return "Çakışmalı gün"
        }
    }

    var detail: String {
        switch self {
        case .emptyDay: return "Randevu yok; boş durum ekranları."
        case .busyDay: return "Karışık durumlu dolu bir gün."
        case .conflictHeavy: return "Takvim neredeyse dolu; çakışma ve öneri akışı."
        }
    }
}
