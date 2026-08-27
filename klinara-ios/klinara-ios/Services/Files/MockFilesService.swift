import Foundation
import UIKit

/// Bellekte yaşayan dosya servisi.
///
/// Sunucunun **akışını** taklit ediyor, sadece liste döndürmüyor: `presign`
/// hiçbir kayıt açmıyor, nesne ancak PUT edildikten sonra var oluyor ve
/// `confirm` var olmayan bir anahtarı reddediyor. Bu sıra bozulduğunda canlıda
/// ne oluyorsa mock'ta da o oluyor.
final class MockFilesService: FilesService, @unchecked Sendable {

    private let lock = NSLock()
    private var records: [CustomerFile] = []
    private var groupRecords: [CustomerFileGroup] = []
    /// `storageKey → gövde`. Nesne depolamasının bellekteki karşılığı.
    private var objects: [String: Data] = [:]
    private var canReadMedical: Bool

    init(canReadMedical: Bool = true) {
        self.canReadMedical = canReadMedical
    }

    func reseed(canReadMedical: Bool) {
        withLock {
            self.canReadMedical = canReadMedical
            records = []
            groupRecords = []
            objects = [:]
        }
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func latency(_ seconds: Double = 0.3) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    // MARK: Akış

    func presign(_ input: PresignUploadInput) async throws -> PresignUploadResponse {
        await latency(0.2)
        try assertCanWrite(input.kind)
        guard FileContentType.allowed.contains(input.contentType) else {
            throw MockErrors.validation("Bu dosya tipi desteklenmiyor", path: "contentType")
        }
        guard input.sizeBytes <= FileContentType.maxBytes else {
            throw MockErrors.validation("Dosya çok büyük", path: "sizeBytes")
        }
        // Anahtar SUNUCUDA üretiliyor; istemciye bırakılsaydı başka bir
        // kiracının yoluna yazmayı deneyebilirdi.
        let key = "\(MockIDs.tenant)/\(input.customerId)/\(MockIDs.uuid())"
        return PresignUploadResponse(
            storageKey: key,
            uploadUrl: "mock://uploads/\(key)",
            contentType: input.contentType,
            expiresAt: Date().addingTimeInterval(300)
        )
    }

    func upload(to url: URL, data: Data, contentType: String) async throws {
        await latency(0.5)
        // `mock://uploads/<key>` — şemadan sonrası anahtar.
        let key = url.absoluteString.replacingOccurrences(of: "mock://uploads/", with: "")
        withLock { objects[key] = data }
    }

    func confirm(customerId: String, _ input: ConfirmFileInput) async throws -> CustomerFile {
        await latency(0.3)
        try assertCanWrite(input.kind)

        return try withLock {
            guard input.storageKey.hasPrefix("\(MockIDs.tenant)/\(customerId)/") else {
                throw MockErrors.forbidden("customer:write")
            }
            // Nesne gerçekten var mı — sunucudaki `HeadObject` kontrolünün
            // karşılığı. Yükleme adımı atlanırsa burada takılır.
            guard let data = objects[input.storageKey] else {
                throw MockErrors.validation("Yüklenen dosya bulunamadı", path: "storageKey")
            }
            guard !records.contains(where: { $0.id == input.storageKey }) else {
                throw MockErrors.duplicateFile
            }

            let file = CustomerFile(
                id: MockIDs.uuid(),
                customerId: customerId,
                groupId: input.groupId,
                kind: input.kind,
                position: input.position ?? .other,
                mimeType: input.kind == .photo ? "image/jpeg" : "application/pdf",
                // Boyut istemcinin beyanından değil NESNENİN KENDİSİNDEN.
                sizeBytes: data.count,
                sha256: input.sha256,
                // Küçük görsel kuyruk işiyle üretiliyor: `confirm` anında
                // HENÜZ hazır değil. Anında `true` dönmek, ızgaradaki yer
                // tutucu yolunu hiç denememek olurdu.
                hasThumbnail: false,
                takenAt: input.takenAt,
                uploadedBy: MockIDs.userOwner,
                createdAt: Date()
            )
            records.append(file)

            if input.kind == .photo {
                scheduleThumbnail(for: file.id)
            }
            return file
        }
    }

    /// Kuyruk işinin karşılığı: birkaç saniye sonra küçük görsel hazır olur.
    private func scheduleThumbnail(for fileId: String) {
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard let self else { return }
            self.withLock {
                guard let index = self.records.firstIndex(where: { $0.id == fileId }) else { return }
                let old = self.records[index]
                self.records[index] = CustomerFile(
                    id: old.id,
                    customerId: old.customerId,
                    groupId: old.groupId,
                    kind: old.kind,
                    position: old.position,
                    mimeType: old.mimeType,
                    sizeBytes: old.sizeBytes,
                    sha256: old.sha256,
                    hasThumbnail: true,
                    takenAt: old.takenAt,
                    uploadedBy: old.uploadedBy,
                    createdAt: old.createdAt
                )
            }
        }
    }

    // MARK: Okuma

    func files(customerId: String) async throws -> [CustomerFile] {
        await latency(0.2)
        return withLock {
            visible(records)
                .filter { $0.customerId == customerId }
                .sorted { $0.createdAt > $1.createdAt }
        }
    }

    func groups(customerId: String) async throws -> [CustomerFileGroup] {
        await latency(0.2)
        return withLock {
            groupRecords.map { group in
                CustomerFileGroup(
                    id: group.id,
                    title: group.title,
                    bodyArea: group.bodyArea,
                    serviceId: group.serviceId,
                    files: visible(records).filter { $0.groupId == group.id },
                    createdAt: group.createdAt
                )
            }
            .sorted { $0.createdAt > $1.createdAt }
        }
    }

    func createGroup(
        customerId: String,
        _ input: CreateFileGroupInput
    ) async throws -> CustomerFileGroup {
        await latency(0.3)
        return withLock {
            let group = CustomerFileGroup(
                id: MockIDs.uuid(),
                title: input.title.trimmingCharacters(in: .whitespacesAndNewlines),
                bodyArea: input.bodyArea,
                serviceId: input.serviceId,
                files: [],
                createdAt: Date()
            )
            groupRecords.append(group)
            return group
        }
    }

    func downloadURL(fileId: String, variant: FileVariant) async throws -> DownloadURL {
        await latency(0.2)
        return try withLock {
            guard let file = visible(records).first(where: { $0.id == fileId }) else {
                // Göremeyeceği dosya 404 döner, 403 değil.
                throw MockErrors.notFound
            }
            // Küçük görsel hazır değilse TAM BOYUTA DÜŞMEZ — sunucu 409 veriyor.
            if variant == .thumb, !file.hasThumbnail {
                throw MockErrors.thumbnailNotReady
            }
            return DownloadURL(
                url: "mock://files/\(fileId)/\(variant.rawValue)",
                expiresAt: Date().addingTimeInterval(300)
            )
        }
    }

    func delete(fileId: String) async throws {
        await latency(0.3)
        try withLock {
            guard let index = records.firstIndex(where: { $0.id == fileId }),
                  visible(records).contains(where: { $0.id == fileId })
            else { throw MockErrors.notFound }
            try assertCanWrite(records[index].kind)
            // Nesne depolamadan SİLİNMEZ: soft delete geri alınabilir olmalı.
            records.remove(at: index)
        }
    }

    // MARK: Yardımcılar

    /// Klinik fotoğraflar `customer.medical:read` olmadan sorgudan hiç çıkmaz.
    private func visible(_ files: [CustomerFile]) -> [CustomerFile] {
        canReadMedical ? files : files.filter { $0.kind == .document }
    }

    private func assertCanWrite(_ kind: FileKind) throws {
        if kind == .photo, !canReadMedical {
            throw MockErrors.forbidden("customer.medical:write")
        }
    }
}

extension MockErrors {

    static var duplicateFile: APIError {
        .problem(ProblemDetails(code: .conflict, title: "Bu dosya zaten kaydedilmiş", status: 409))
    }

    static var thumbnailNotReady: APIError {
        .problem(ProblemDetails(
            code: .conflict,
            title: "Küçük görsel henüz hazır değil",
            status: 409
        ))
    }
}
