import CryptoKit
import Foundation
import UIKit

/// Üç adımlı yükleme akışını tek çağrıda toplar: hazırla → PUT → `confirm`.
///
/// Adımların ekran kodunda tekrarlanması, birinde `sha256` gönderilip
/// diğerinde unutulması demekti; sunucu tarafında bunun karşılığı sessizce
/// `pending`de kalan bir kayıt.
struct FileUploader: Sendable {

    private let service: any FilesService

    init(service: any FilesService) {
        self.service = service
    }

    /// Ham görselden yüklenebilir gövde. Ne yüklendiğini çağıran görebilsin
    /// diye ayrı bir tip: boyut ve tip `presign` beyanına giriyor.
    struct Payload: Sendable {
        let data: Data
        let contentType: String
    }

    /// Yükleme sırasındaki adım — ilerleme göstergesi için.
    enum Step: Sendable {
        case preparing
        case requestingURL
        case uploading
        case confirming
    }

    // MARK: Hazırlama

    /// Kamera/galeri çıktısını yüklenebilir hâle getirir.
    ///
    /// Ham kamera çıktısı `UPLOAD_MAX_BYTES` (25 MB) sınırını zorlayabiliyor ve
    /// klinik fotoğrafı için tam çözünürlük gerekmiyor: uzun kenar 2048'e
    /// indiriliyor, sonra sınırın altına inene kadar JPEG kalitesi düşürülüyor.
    ///
    /// HEIC **yeniden kodlanıyor**: sunucu kabul etse de, `sharp` tarafındaki
    /// küçük görsel işi ve istemcideki önizleme için JPEG her yerde çalışıyor.
    static func prepare(image: UIImage, maxBytes: Int = FileContentType.maxBytes) -> Payload? {
        let resized = resize(image, longestSide: 2048)
        var quality: CGFloat = 0.85

        while quality >= 0.4 {
            guard let data = resized.jpegData(compressionQuality: quality) else { return nil }
            if data.count <= maxBytes {
                return Payload(data: data, contentType: "image/jpeg")
            }
            quality -= 0.15
        }
        // Bu boyuta inmeyen bir fotoğraf pratikte yok; yine de sessizce
        // sınırın üstünde bir gövde göndermiyoruz — sunucu reddederdi.
        return nil
    }

    /// Belge (PDF) gövdesi. Yeniden kodlama yok; yalnız tip ve boyut kontrolü.
    static func prepare(documentData: Data, contentType: String) -> Payload? {
        guard FileContentType.allowed.contains(contentType),
              documentData.count <= FileContentType.maxBytes
        else { return nil }
        return Payload(data: documentData, contentType: contentType)
    }

    /// Küçültme **piksel** cinsinden yapılır, nokta cinsinden değil.
    ///
    /// `UIImage.size` noktadır ve `scale` ile çarpılmadan gerçek çözünürlüğü
    /// vermez; 3x ölçekli bir görselde nokta hesabı hedefin üç katını üretir.
    /// Çıktı da 1x ölçekle veriliyor: yüklenen nesnenin piksel boyutu ile
    /// beyan ettiğimiz boyut aynı şeyi anlatmalı.
    private static func resize(_ image: UIImage, longestSide: CGFloat) -> UIImage {
        let pixelWidth = image.size.width * image.scale
        let pixelHeight = image.size.height * image.scale
        let side = max(pixelWidth, pixelHeight)

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1

        guard side > longestSide else {
            // Ölçeği 1'e indirmek için yine de yeniden çiziliyor: aksi hâlde
            // küçük bir 3x görsel, boyutundan üç kat büyük bir JPEG üretirdi.
            let size = CGSize(width: pixelWidth, height: pixelHeight)
            let renderer = UIGraphicsImageRenderer(size: size, format: format)
            return renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        }

        let ratio = longestSide / side
        let size = CGSize(width: pixelWidth * ratio, height: pixelHeight * ratio)
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }

    /// İçeriğin sha256 özeti (hex). Sunucu `HeadObject` ile içerik özeti
    /// alamıyor (çok parçalı yüklemede ETag hash değildir), bu yüzden doğrulama
    /// worker'da yapılıyor ve beyan istemciden geliyor.
    static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Akış

    /// `presign` → PUT → `confirm`. Her adımın hatası kendi anlamıyla çıkar;
    /// tek bir "yükleme başarısız" mesajı kullanıcıya ne yapacağını söylemezdi.
    func upload(
        payload: Payload,
        customerId: String,
        kind: FileKind,
        position: FilePosition = .other,
        groupId: String? = nil,
        takenAt: Date? = nil,
        onStep: (@Sendable (Step) -> Void)? = nil
    ) async throws -> CustomerFile {
        onStep?(.requestingURL)
        let ticket = try await service.presign(PresignUploadInput(
            customerId: customerId,
            contentType: payload.contentType,
            sizeBytes: payload.data.count,
            kind: kind
        ))

        guard let url = URL(string: ticket.uploadUrl) else {
            throw APIError.malformedResponse("Yükleme adresi çözülemedi")
        }

        onStep?(.uploading)
        // `Content-Type` presign yanıtındakiyle BİREBİR aynı gitmeli: imza onu
        // kapsıyor, farklı bir değer imzayı geçersiz kılar.
        try await service.upload(to: url, data: payload.data, contentType: ticket.contentType)

        onStep?(.confirming)
        return try await service.confirm(customerId: customerId, ConfirmFileInput(
            storageKey: ticket.storageKey,
            kind: kind,
            position: position,
            groupId: groupId,
            sha256: Self.sha256(payload.data),
            takenAt: takenAt
        ))
    }
}
