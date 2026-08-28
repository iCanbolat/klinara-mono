import Foundation

/// Personel primi uçlarının istemci sözleşmesi (Faz 6.4).
///
/// ``FinanceService``den ayrı: izin ailesi farklı (`finance.commission:read` /
/// `:write`) ve ekran ailesi farklı. Muhasebe primi **görür** ama kuralını
/// değiştiremez; iki sözleşmeyi birleştirmek bu ayrımı kodda görünmez kılardı.
protocol CommissionsService: Sendable {

    /// `GET /commission-rules` — cursor sayfalamalı.
    func rules(cursor: String?, limit: Int?) async throws -> Page<CommissionRule>

    /// `POST /commission-rules` — aynı kapsam + personel + öncelik ile ikinci
    /// bir aktif kural olamaz; sunucu `CONFLICT` döner.
    func createRule(_ input: CreateCommissionRuleInput) async throws -> CommissionRule

    /// `PATCH /commission-rules/:id` — `If-Match` zorunlu. Kapsam, matrah ve
    /// tetikleyici değiştirilemez (bkz. ``UpdateCommissionRuleInput``).
    func updateRule(
        id: String,
        version: Int,
        _ input: UpdateCommissionRuleInput
    ) async throws -> CommissionRule

    /// `DELETE /commission-rules/:id` — `If-Match` zorunlu, yanıt gövdesiz.
    func deleteRule(id: String, version: Int) async throws

    /// `GET /commissions/accruals` — append-only; ters kayıtlar negatif.
    func accruals(
        cursor: String?,
        limit: Int?,
        staffProfileId: String?,
        periodId: String?
    ) async throws -> Page<CommissionAccrual>

    /// `GET /commission-periods` — yanıt **çıplak dizi**, `{ data: … }` zarfı YOK.
    ///
    /// Dönemler ilk tahakkukta **otomatik** açılıyor; oluşturma ucu yok
    /// (Ek K devreden madde). Ekran bu yüzden "dönem ekle" sunmuyor.
    func periods(branchId: String?, status: CommissionPeriodStatus?) async throws -> [CommissionPeriod]

    /// `POST /commission-periods/:id/close` — `If-Match` zorunlu. Kapalı döneme
    /// tahakkuk yazılamaz; düzeltmeler cari döneme düşer.
    func closePeriod(id: String, version: Int) async throws -> CommissionPeriod

    /// `GET /reports/commissions` — ters kayıtlar düşülmüş personel özeti.
    func report(
        periodId: String?,
        branchId: String?,
        from: String?,
        to: String?
    ) async throws -> CommissionReport
}

struct LiveCommissionsService: CommissionsService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func rules(cursor: String?, limit: Int?) async throws -> Page<CommissionRule> {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        return try await client.send(APIRequest.get("commission-rules", query: query))
    }

    func createRule(_ input: CreateCommissionRuleInput) async throws -> CommissionRule {
        try await client.send(APIRequest.post("commission-rules", body: input))
    }

    func updateRule(
        id: String,
        version: Int,
        _ input: UpdateCommissionRuleInput
    ) async throws -> CommissionRule {
        try await client.send(APIRequest.patch(
            "commission-rules/\(id)",
            body: input,
            ifMatch: weakETag(version)
        ))
    }

    func deleteRule(id: String, version: Int) async throws {
        try await client.send(APIRequest.delete("commission-rules/\(id)", ifMatch: weakETag(version)))
    }

    func accruals(
        cursor: String?,
        limit: Int?,
        staffProfileId: String?,
        periodId: String?
    ) async throws -> Page<CommissionAccrual> {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let staffProfileId {
            query.append(URLQueryItem(name: "staffProfileId", value: staffProfileId))
        }
        if let periodId { query.append(URLQueryItem(name: "periodId", value: periodId)) }
        return try await client.send(APIRequest.get("commissions/accruals", query: query))
    }

    func periods(
        branchId: String?,
        status: CommissionPeriodStatus?
    ) async throws -> [CommissionPeriod] {
        var query: [URLQueryItem] = []
        if let branchId { query.append(URLQueryItem(name: "branchId", value: branchId)) }
        if let status { query.append(URLQueryItem(name: "status", value: status.rawValue)) }
        return try await client.send(APIRequest.get("commission-periods", query: query))
    }

    func closePeriod(id: String, version: Int) async throws -> CommissionPeriod {
        try await client.send(APIRequest.post(
            "commission-periods/\(id)/close",
            ifMatch: weakETag(version)
        ))
    }

    func report(
        periodId: String?,
        branchId: String?,
        from: String?,
        to: String?
    ) async throws -> CommissionReport {
        var query: [URLQueryItem] = []
        if let periodId { query.append(URLQueryItem(name: "periodId", value: periodId)) }
        if let branchId { query.append(URLQueryItem(name: "branchId", value: branchId)) }
        if let from { query.append(URLQueryItem(name: "from", value: from)) }
        if let to { query.append(URLQueryItem(name: "to", value: to)) }
        return try await client.send(APIRequest.get("reports/commissions", query: query))
    }
}
