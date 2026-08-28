import Foundation

/// Borç, tahsilat, kasa ve iade uçlarının istemci sözleşmesi (Faz 6.1–6.3).
///
/// Prim (6.4) ayrı bir protokoldedir: ayrı bir izin ailesine (`finance.commission:*`)
/// bakıyor ve ayrı bir ekran ailesini besliyor. Muhasebeci primi görüp tahsilat
/// yazamayabilir; iki sözleşmeyi tek protokolde toplamak bu ayrımı kodda
/// görünmez kılardı.
///
/// **İyimser kilit ve tekrar güvenliği protokolde açıkça görünür:** `version`
/// alan metotlar `If-Match` gönderir, `idempotencyKey` alanlar tekrarlanan
/// isteği ikinci bir yazıya çevirmez. Faz 5'teki ``PackagesService`` deseni.
protocol FinanceService: Sendable {

    // MARK: Ücret kalemleri (6.1)

    /// `POST /charges` — yalnız `product` ve `manual`. `X-Branch-Id` başlığını
    /// ``APIClient`` seçili şubeden koyar.
    func createCharge(_ input: CreateChargeInput, idempotencyKey: String?) async throws -> Charge

    /// `GET /charges` — cursor sayfalamalı.
    func charges(
        cursor: String?,
        limit: Int?,
        customerId: String?,
        branchId: String?,
        source: ChargeSource?,
        status: ChargeStatus?,
        from: Date?,
        to: Date?
    ) async throws -> Page<Charge>

    /// `GET /charges/:id`
    func charge(id: String) async throws -> Charge

    /// `PATCH /charges/:id` — `If-Match` zorunlu.
    func updateCharge(id: String, version: Int, _ input: UpdateChargeInput) async throws -> Charge

    /// `POST /charges/:id/void` — kalem SİLİNMEZ, iptal edilir. `If-Match` zorunlu.
    func voidCharge(id: String, version: Int, reason: String) async throws -> Charge

    /// `GET /customers/:id/account` — cari hesap; bakiye burada hesaplanır.
    func account(customerId: String, cursor: String?, limit: Int?) async throws -> CustomerAccount

    // MARK: Tahsilat (6.2)

    /// `POST /payments` — `allocations` verilmezse sunucu açık kalemlere
    /// eskiden yeniye dağıtır, artan avans kalır.
    func createPayment(_ input: CreatePaymentInput, idempotencyKey: String?) async throws -> Payment

    /// `GET /payments`
    func payments(
        cursor: String?,
        limit: Int?,
        customerId: String?,
        branchId: String?,
        method: PaymentMethod?,
        status: PaymentStatus?,
        from: Date?,
        to: Date?
    ) async throws -> Page<Payment>

    /// `GET /payments/:id`
    func payment(id: String) async throws -> Payment

    /// `POST /payments/:id/void` — tahsis satırları SİLİNMEZ, bakiye geri gelir.
    func voidPayment(id: String, version: Int, reason: String) async throws -> Payment

    // MARK: Kasa ve iade (6.3)

    /// `POST /cash-sessions/open` — şube başına yalnız bir açık oturum.
    func openCashSession(_ input: OpenCashSessionInput) async throws -> CashSession

    /// `POST /cash-sessions/:id/close` — farkta gerekçe zorunlu. `If-Match` zorunlu.
    func closeCashSession(
        id: String,
        version: Int,
        _ input: CloseCashSessionInput
    ) async throws -> CashSession

    /// `GET /cash-sessions`
    func cashSessions(
        cursor: String?,
        limit: Int?,
        branchId: String?,
        status: CashSessionStatus?
    ) async throws -> Page<CashSession>

    /// `GET /cash-sessions/:id/summary` — beklenen tutar, yöntem kırılımı, hareketler.
    func cashSessionSummary(id: String) async throws -> CashSessionSummary

    /// `POST /refunds` — nakit iadede açık kasa zorunlu.
    func createRefund(_ input: CreateRefundInput, idempotencyKey: String?) async throws -> Refund

    // MARK: İndirimler (6.1)
    //
    // Uçlar `service:read` / `service:write` ile korunur; indirim bir katalog
    // tanımıdır, günlük tahsilat işlemi değil.

    /// `GET /discounts`
    func discounts(cursor: String?, limit: Int?, activeOnly: Bool?) async throws -> Page<Discount>

    /// `GET /discounts/:id`
    func discount(id: String) async throws -> Discount

    /// `POST /discounts`
    func createDiscount(_ input: CreateDiscountInput) async throws -> Discount

    /// `PATCH /discounts/:id` — `If-Match` zorunlu.
    func updateDiscount(
        id: String,
        version: Int,
        _ input: UpdateDiscountInput
    ) async throws -> Discount

    /// `DELETE /discounts/:id` — `If-Match` zorunlu, yanıt gövdesiz.
    func deleteDiscount(id: String, version: Int) async throws
}

struct LiveFinanceService: FinanceService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    // MARK: Ücret kalemleri

    func createCharge(_ input: CreateChargeInput, idempotencyKey: String?) async throws -> Charge {
        try await client.send(APIRequest.post(
            "charges",
            body: input,
            idempotencyKey: idempotencyKey
        ))
    }

    func charges(
        cursor: String?,
        limit: Int?,
        customerId: String?,
        branchId: String?,
        source: ChargeSource?,
        status: ChargeStatus?,
        from: Date?,
        to: Date?
    ) async throws -> Page<Charge> {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let customerId { query.append(URLQueryItem(name: "customerId", value: customerId)) }
        if let branchId { query.append(URLQueryItem(name: "branchId", value: branchId)) }
        // `.unknown` sunucuda geçerli bir değer DEĞİL; süzgeç olarak
        // gönderilirse 422 alırdık. İstemci tarafı bir yer tutucu.
        if let source, source != .unknown {
            query.append(URLQueryItem(name: "source", value: source.rawValue))
        }
        if let status { query.append(URLQueryItem(name: "status", value: status.rawValue)) }
        if let from { query.append(URLQueryItem(name: "from", value: KlinaraCoding.timestamp(from))) }
        if let to { query.append(URLQueryItem(name: "to", value: KlinaraCoding.timestamp(to))) }
        return try await client.send(APIRequest.get("charges", query: query))
    }

    func charge(id: String) async throws -> Charge {
        try await client.send(APIRequest.get("charges/\(id)"))
    }

    func updateCharge(id: String, version: Int, _ input: UpdateChargeInput) async throws -> Charge {
        try await client.send(APIRequest.patch(
            "charges/\(id)",
            body: input,
            ifMatch: weakETag(version)
        ))
    }

    func voidCharge(id: String, version: Int, reason: String) async throws -> Charge {
        try await client.send(APIRequest.post(
            "charges/\(id)/void",
            body: ReasonInput(reason: reason),
            ifMatch: weakETag(version)
        ))
    }

    func account(customerId: String, cursor: String?, limit: Int?) async throws -> CustomerAccount {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        return try await client.send(APIRequest.get("customers/\(customerId)/account", query: query))
    }

    // MARK: Tahsilat

    func createPayment(_ input: CreatePaymentInput, idempotencyKey: String?) async throws -> Payment {
        try await client.send(APIRequest.post(
            "payments",
            body: input,
            idempotencyKey: idempotencyKey
        ))
    }

    func payments(
        cursor: String?,
        limit: Int?,
        customerId: String?,
        branchId: String?,
        method: PaymentMethod?,
        status: PaymentStatus?,
        from: Date?,
        to: Date?
    ) async throws -> Page<Payment> {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let customerId { query.append(URLQueryItem(name: "customerId", value: customerId)) }
        if let branchId { query.append(URLQueryItem(name: "branchId", value: branchId)) }
        if let method { query.append(URLQueryItem(name: "method", value: method.rawValue)) }
        if let status { query.append(URLQueryItem(name: "status", value: status.rawValue)) }
        if let from { query.append(URLQueryItem(name: "from", value: KlinaraCoding.timestamp(from))) }
        if let to { query.append(URLQueryItem(name: "to", value: KlinaraCoding.timestamp(to))) }
        return try await client.send(APIRequest.get("payments", query: query))
    }

    func payment(id: String) async throws -> Payment {
        try await client.send(APIRequest.get("payments/\(id)"))
    }

    func voidPayment(id: String, version: Int, reason: String) async throws -> Payment {
        try await client.send(APIRequest.post(
            "payments/\(id)/void",
            body: ReasonInput(reason: reason),
            ifMatch: weakETag(version)
        ))
    }

    // MARK: Kasa ve iade

    func openCashSession(_ input: OpenCashSessionInput) async throws -> CashSession {
        try await client.send(APIRequest.post("cash-sessions/open", body: input))
    }

    func closeCashSession(
        id: String,
        version: Int,
        _ input: CloseCashSessionInput
    ) async throws -> CashSession {
        try await client.send(APIRequest.post(
            "cash-sessions/\(id)/close",
            body: input,
            ifMatch: weakETag(version)
        ))
    }

    func cashSessions(
        cursor: String?,
        limit: Int?,
        branchId: String?,
        status: CashSessionStatus?
    ) async throws -> Page<CashSession> {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let branchId { query.append(URLQueryItem(name: "branchId", value: branchId)) }
        if let status { query.append(URLQueryItem(name: "status", value: status.rawValue)) }
        return try await client.send(APIRequest.get("cash-sessions", query: query))
    }

    func cashSessionSummary(id: String) async throws -> CashSessionSummary {
        try await client.send(APIRequest.get("cash-sessions/\(id)/summary"))
    }

    func createRefund(_ input: CreateRefundInput, idempotencyKey: String?) async throws -> Refund {
        try await client.send(APIRequest.post(
            "refunds",
            body: input,
            idempotencyKey: idempotencyKey
        ))
    }

    // MARK: İndirimler

    func discounts(cursor: String?, limit: Int?, activeOnly: Bool?) async throws -> Page<Discount> {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        // Sorgu dizesinde boolean yok, metin var — `definitions(isActive:)` ile aynı.
        if let activeOnly {
            query.append(URLQueryItem(name: "activeOnly", value: activeOnly ? "true" : "false"))
        }
        return try await client.send(APIRequest.get("discounts", query: query))
    }

    func discount(id: String) async throws -> Discount {
        try await client.send(APIRequest.get("discounts/\(id)"))
    }

    func createDiscount(_ input: CreateDiscountInput) async throws -> Discount {
        try await client.send(APIRequest.post("discounts", body: input))
    }

    func updateDiscount(
        id: String,
        version: Int,
        _ input: UpdateDiscountInput
    ) async throws -> Discount {
        try await client.send(APIRequest.patch(
            "discounts/\(id)",
            body: input,
            ifMatch: weakETag(version)
        ))
    }

    func deleteDiscount(id: String, version: Int) async throws {
        try await client.send(APIRequest.delete("discounts/\(id)", ifMatch: weakETag(version)))
    }
}
