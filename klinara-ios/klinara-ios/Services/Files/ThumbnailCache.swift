import SwiftUI

/// Küçük görsel önbelleği — `fileId → UIImage`.
///
/// **Adres değil görüntü** önbellekleniyor: imzalı indirme adresi kısa TTL'li
/// (varsayılan 5 dakika), onu saklamak birkaç dakika sonra ölü bağlantılardan
/// oluşan bir önbellek tutmak olurdu.
///
/// İkinci fayda: her `download-url` çağrısı `customer_record_access_log`a
/// düşüyor. Önbellek olmasaydı ızgara her kaydırmada erişim kaydı üretirdi ve
/// KVKK raporu gerçek erişimleri gürültünün içinde kaybederdi.
@MainActor
@Observable
final class ThumbnailCache {

    private let service: any FilesService
    private let cache = NSCache<NSString, UIImage>()
    /// Süren indirmeler — aynı hücre birden çok kez çizildiğinde ikinci bir
    /// istek atılmasın.
    private var inFlight: [String: Task<UIImage?, Never>] = [:]

    init(service: any FilesService) {
        self.service = service
        cache.countLimit = 200
    }

    func cached(_ fileId: String) -> UIImage? {
        cache.object(forKey: fileId as NSString)
    }

    /// Küçük görseli getirir. Kuyruk işi henüz bitmediyse sunucu `409` döner;
    /// bu bir hata değil, "birazdan" demektir — `nil` dönülür ve ızgara yer
    /// tutucuyu göstermeye devam eder.
    func thumbnail(for file: CustomerFile) async -> UIImage? {
        if let hit = cached(file.id) { return hit }
        guard file.hasThumbnail else { return nil }
        if let running = inFlight[file.id] { return await running.value }

        let task = Task<UIImage?, Never> { [service] in
            do {
                let link = try await service.downloadURL(fileId: file.id, variant: .thumb)
                guard let url = URL(string: link.url) else { return nil }
                let (data, _) = try await URLSession.shared.data(from: url)
                return UIImage(data: data)
            } catch {
                return nil
            }
        }
        inFlight[file.id] = task
        let image = await task.value
        inFlight[file.id] = nil
        if let image { cache.setObject(image, forKey: file.id as NSString) }
        return image
    }

    /// Tam boyut. Önbelleğe **alınmaz**: tek tek açılan büyük görselleri
    /// bellekte tutmanın karşılığı yok ve her açılış zaten `download` olarak
    /// erişim kaydına düşmeli.
    func original(for file: CustomerFile) async throws -> UIImage? {
        let link = try await service.downloadURL(fileId: file.id, variant: .original)
        guard let url = URL(string: link.url) else { return nil }
        let (data, _) = try await URLSession.shared.data(from: url)
        return UIImage(data: data)
    }
}
