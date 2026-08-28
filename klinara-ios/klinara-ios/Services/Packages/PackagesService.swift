import Foundation

/// Paket ve seans hakkı uçlarının istemci sözleşmesi (Faz 5).
///
/// Dört alt bölüm tek protokolde toplanıyor: tanımlar (5.1), satış ve defter
/// (5.2), operasyonlar (5.3) ve raporlar (5.4). Sunucuda dört ayrı controller
/// var ama istemci tarafında hepsi aynı ekran ailesini besliyor; ayrı
/// protokollere bölmek çağıranı dört bağımlılık taşımaya zorlardı.
///
/// **İyimser kilit ve tekrar güvenliği bu protokolde açıkça görünür:**
/// `version` alan metotlar `If-Match` gönderir, `idempotencyKey` alanlar
/// tekrarlanan isteği ikinci bir yazıya çevirmez. İkisi farklı hataları
/// durdurur ve para/hak dokunan uçlarda birlikte kullanılır.
protocol PackagesService: Sendable {

    // MARK: Tanımlar (5.1)

    /// `GET /package-definitions` — cursor sayfalamalı.
    func definitions(
        cursor: String?,
        limit: Int?,
        branchId: String?,
        serviceId: String?,
        isActive: Bool?
    ) async throws -> Page<PackageDefinition>

    /// `GET /package-definitions/:id`
    func definition(id: String) async throws -> PackageDefinition

    /// `POST /package-definitions`
    func createDefinition(_ input: CreatePackageDefinitionInput) async throws -> PackageDefinition

    /// `PATCH /package-definitions/:id` — `If-Match` zorunlu.
    ///
    /// Değişiklik **satılmış paketleri etkilemez**: satış anında alınan
    /// snapshot geçerlidir.
    func updateDefinition(
        id: String,
        version: Int,
        _ input: UpdatePackageDefinitionInput
    ) async throws -> PackageDefinition

    /// `DELETE /package-definitions/:id` — satılmamışsa arşivler, satılmışsa
    /// yalnız pasife alır. `If-Match` zorunlu, yanıt gövdesiz (`204`).
    func retireDefinition(id: String, version: Int) async throws

    // MARK: Satış ve defter (5.2)

    /// `POST /customer-packages` — satış. `X-Branch-Id` başlığını ``APIClient``
    /// seçili şubeden koyar; `idempotencyKey` aynı satışın iki kez yazılmasını
    /// engeller ve **çağıran boyunca sabit kalmalıdır**.
    func sell(
        _ input: CreateCustomerPackageInput,
        idempotencyKey: String?
    ) async throws -> CustomerPackage

    /// `GET /customers/:id/packages` — kalemler gömülü, cursor sayfalamalı.
    func packages(
        customerId: String,
        cursor: String?,
        limit: Int?,
        status: CustomerPackageStatus?
    ) async throws -> Page<CustomerPackage>

    /// `GET /customer-packages/:id`
    func package(id: String) async throws -> CustomerPackage

    /// `GET /customer-packages/:id/ledger` — yeniden eskiye, append-only.
    func ledger(
        packageId: String,
        cursor: String?,
        limit: Int?
    ) async throws -> Page<PackageLedgerEntry>

    // MARK: Operasyonlar (5.3)

    /// `GET /customers/:id/package-entitlements` — randevu ekranının paket
    /// seçimi için kullanılabilir haklar.
    ///
    /// Yanıt **çıplak dizi**dir, `{ "data": [...] }` zarfı YOKTUR — müşteri
    /// aramasıyla aynı istisna.
    func entitlements(
        customerId: String,
        serviceId: String?,
        branchId: String?
    ) async throws -> [PackageEntitlement]

    /// `POST /appointments/:id/consume-package` — randevu kalemlerini pakete
    /// bağlar; randevu zaten `completed` ise aynı çağrıda düşer de.
    func consume(
        appointmentId: String,
        _ input: ConsumePackageInput,
        idempotencyKey: String?
    ) async throws -> ConsumePackageResult

    /// `POST /customer-packages/:id/adjust` — gerekçe zorunlu, `If-Match` zorunlu.
    func adjust(
        id: String,
        version: Int,
        _ input: AdjustPackageInput
    ) async throws -> CustomerPackage

    /// `POST /customer-packages/:id/refund` — `package:refund` izni ister.
    /// Tutar satış anındaki tahsisten hesaplanır; kasa hareketi YOKTUR.
    func refund(
        id: String,
        version: Int,
        _ input: RefundPackageInput,
        idempotencyKey: String?
    ) async throws -> RefundResult

    /// `POST /customer-packages/:id/transfer` — `package:transfer` izni ister.
    /// Yanıt **hedef müşteride açılan yeni pakettir**, kaynak paket değil.
    func transfer(
        id: String,
        version: Int,
        _ input: TransferPackageInput,
        idempotencyKey: String?
    ) async throws -> CustomerPackage

    // MARK: Raporlar (5.4)

    /// `GET /reports/packages/outstanding` — `report.revenue:read` izni ister.
    func outstandingReport(
        branchId: String?,
        serviceId: String?,
        groupBy: OutstandingGrouping?
    ) async throws -> OutstandingReport

    /// `GET /reports/packages/expiring` — aralık **yarı açık**: `[from, to)`.
    func expiringReport(
        from: Date,
        to: Date,
        branchId: String?,
        cursor: String?,
        limit: Int?
    ) async throws -> ExpiringReport

    /// `GET /reports/packages/usage` — aralık **yarı açık**: `[from, to)`.
    func usageReport(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: UsageGrouping?
    ) async throws -> UsageReport
}

struct LivePackagesService: PackagesService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    // MARK: Tanımlar

    func definitions(
        cursor: String?,
        limit: Int?,
        branchId: String?,
        serviceId: String?,
        isActive: Bool?
    ) async throws -> Page<PackageDefinition> {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let branchId { query.append(URLQueryItem(name: "branchId", value: branchId)) }
        if let serviceId { query.append(URLQueryItem(name: "serviceId", value: serviceId)) }
        // Sorgu dizesinde boolean yok, metin var: sunucu "true"/"false" bekliyor.
        if let isActive { query.append(URLQueryItem(name: "isActive", value: isActive ? "true" : "false")) }
        return try await client.send(APIRequest.get("package-definitions", query: query))
    }

    func definition(id: String) async throws -> PackageDefinition {
        try await client.send(APIRequest.get("package-definitions/\(id)"))
    }

    func createDefinition(_ input: CreatePackageDefinitionInput) async throws -> PackageDefinition {
        try await client.send(APIRequest.post("package-definitions", body: input))
    }

    func updateDefinition(
        id: String,
        version: Int,
        _ input: UpdatePackageDefinitionInput
    ) async throws -> PackageDefinition {
        try await client.send(APIRequest.patch(
            "package-definitions/\(id)",
            body: input,
            ifMatch: weakETag(version)
        ))
    }

    func retireDefinition(id: String, version: Int) async throws {
        try await client.send(APIRequest.delete(
            "package-definitions/\(id)",
            ifMatch: weakETag(version)
        ))
    }

    // MARK: Satış ve defter

    func sell(
        _ input: CreateCustomerPackageInput,
        idempotencyKey: String?
    ) async throws -> CustomerPackage {
        try await client.send(APIRequest.post(
            "customer-packages",
            body: input,
            idempotencyKey: idempotencyKey
        ))
    }

    func packages(
        customerId: String,
        cursor: String?,
        limit: Int?,
        status: CustomerPackageStatus?
    ) async throws -> Page<CustomerPackage> {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let status { query.append(URLQueryItem(name: "status", value: status.rawValue)) }
        return try await client.send(APIRequest.get("customers/\(customerId)/packages", query: query))
    }

    func package(id: String) async throws -> CustomerPackage {
        try await client.send(APIRequest.get("customer-packages/\(id)"))
    }

    func ledger(
        packageId: String,
        cursor: String?,
        limit: Int?
    ) async throws -> Page<PackageLedgerEntry> {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        return try await client.send(APIRequest.get("customer-packages/\(packageId)/ledger", query: query))
    }

    // MARK: Operasyonlar

    func entitlements(
        customerId: String,
        serviceId: String?,
        branchId: String?
    ) async throws -> [PackageEntitlement] {
        var query: [URLQueryItem] = []
        if let serviceId { query.append(URLQueryItem(name: "serviceId", value: serviceId)) }
        if let branchId { query.append(URLQueryItem(name: "branchId", value: branchId)) }
        return try await client.send(
            APIRequest.get("customers/\(customerId)/package-entitlements", query: query)
        )
    }

    func consume(
        appointmentId: String,
        _ input: ConsumePackageInput,
        idempotencyKey: String?
    ) async throws -> ConsumePackageResult {
        try await client.send(APIRequest.post(
            "appointments/\(appointmentId)/consume-package",
            body: input,
            idempotencyKey: idempotencyKey
        ))
    }

    func adjust(
        id: String,
        version: Int,
        _ input: AdjustPackageInput
    ) async throws -> CustomerPackage {
        try await client.send(APIRequest.post(
            "customer-packages/\(id)/adjust",
            body: input,
            ifMatch: weakETag(version)
        ))
    }

    func refund(
        id: String,
        version: Int,
        _ input: RefundPackageInput,
        idempotencyKey: String?
    ) async throws -> RefundResult {
        try await client.send(APIRequest.post(
            "customer-packages/\(id)/refund",
            body: input,
            idempotencyKey: idempotencyKey,
            ifMatch: weakETag(version)
        ))
    }

    func transfer(
        id: String,
        version: Int,
        _ input: TransferPackageInput,
        idempotencyKey: String?
    ) async throws -> CustomerPackage {
        try await client.send(APIRequest.post(
            "customer-packages/\(id)/transfer",
            body: input,
            idempotencyKey: idempotencyKey,
            ifMatch: weakETag(version)
        ))
    }

    // MARK: Raporlar

    func outstandingReport(
        branchId: String?,
        serviceId: String?,
        groupBy: OutstandingGrouping?
    ) async throws -> OutstandingReport {
        var query: [URLQueryItem] = []
        if let branchId { query.append(URLQueryItem(name: "branchId", value: branchId)) }
        if let serviceId { query.append(URLQueryItem(name: "serviceId", value: serviceId)) }
        if let groupBy { query.append(URLQueryItem(name: "groupBy", value: groupBy.rawValue)) }
        return try await client.send(APIRequest.get("reports/packages/outstanding", query: query))
    }

    func expiringReport(
        from: Date,
        to: Date,
        branchId: String?,
        cursor: String?,
        limit: Int?
    ) async throws -> ExpiringReport {
        var query = [
            URLQueryItem(name: "from", value: KlinaraCoding.timestamp(from)),
            URLQueryItem(name: "to", value: KlinaraCoding.timestamp(to)),
        ]
        if let branchId { query.append(URLQueryItem(name: "branchId", value: branchId)) }
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        return try await client.send(APIRequest.get("reports/packages/expiring", query: query))
    }

    func usageReport(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: UsageGrouping?
    ) async throws -> UsageReport {
        var query = [
            URLQueryItem(name: "from", value: KlinaraCoding.timestamp(from)),
            URLQueryItem(name: "to", value: KlinaraCoding.timestamp(to)),
        ]
        if let branchId { query.append(URLQueryItem(name: "branchId", value: branchId)) }
        if let groupBy { query.append(URLQueryItem(name: "groupBy", value: groupBy.rawValue)) }
        return try await client.send(APIRequest.get("reports/packages/usage", query: query))
    }
}
