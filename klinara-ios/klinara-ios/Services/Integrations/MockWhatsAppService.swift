import Foundation

/// Sunucu olmadan WhatsApp kurulum ve gelen kutusu ekranlarını sürmek için
/// bellek-içi defter.
///
/// Sunucunun üç davranışını taklit eder:
///
/// - **Ham token asla dönmez**: kaydedilen token maskeleniyor ve saklanmıyor;
///   mock'ta bile `accessToken`ı geri döndürmek, ekranın onu okuyabileceği
///   izlenimini verir ve canlıda çalışmayan bir arayüz doğururdu.
/// - **Kalıcı / geçici hata ayrımı**: onaysız şablon `422`
///   (``APIErrorCode/whatsappTemplateNotApproved``), kota `503`
///   (``APIErrorCode/whatsappRateLimited``). Ekranın "tekrar dene" düğmesini
///   yalnız ikincisinde göstermesi buna bağlı.
/// - **Test gönderimi sıfır parametreyle gider**: değişken bekleyen bir şablon
///   reddedilir.
final class MockWhatsAppService: WhatsAppService, @unchecked Sendable {

    private let lock = NSLock()
    /// Test gönderimi mesaj günlüğünde iz bıraksın diye. Gerçek sunucuda ikisi
    /// aynı `message_log` tablosuna yazıyor.
    private let messages: MockMessagesService

    private var accountRecord: WhatsAppAccount?
    private var templateRecords: [WhatsAppTemplate] = []
    private var inboxRecords: [InboxItem] = []
    /// Kota simülasyonu: aynı numaraya arka arkaya üçüncü test gönderimi
    /// geçici hataya düşer.
    private var testSendCount: [String: Int] = [:]

    init(messages: MockMessagesService) {
        self.messages = messages
        seed()
    }

    func reseed() {
        withLock { seed() }
    }

    private func seed() {
        let now = Date()
        accountRecord = MockNotificationsSeed.account(at: now)
        templateRecords = MockNotificationsSeed.whatsAppTemplates(at: now)
        inboxRecords = MockNotificationsSeed.inbox(at: now)
        testSendCount = [:]
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func latency(_ seconds: Double = 0.4) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    // MARK: Hatalar

    private func notFound() -> APIError {
        .problem(ProblemDetails(code: .notFound, title: "Bulunamadı", status: 404))
    }

    private func permanent(_ code: APIErrorCode, _ detail: String) -> APIError {
        .problem(ProblemDetails(code: code, title: "Gönderilemedi", detail: detail, status: 422))
    }

    private func rateLimited() -> APIError {
        .problem(ProblemDetails(
            code: .whatsappRateLimited,
            title: "Kota doldu",
            detail: "Sağlayıcı gönderim kotası aşıldı",
            status: 503
        ))
    }

    // MARK: Hesap

    func account() async throws -> WhatsAppAccount? {
        await latency(0.3)
        return withLock { accountRecord }
    }

    func upsertAccount(_ input: UpsertWhatsAppAccountInput) async throws -> WhatsAppAccount {
        await latency()
        return withLock {
            // Kaydetmek hesabı DOĞRULANMAMIŞ duruma düşürür: yeni kimlik
            // bilgileri Meta'ya karşı henüz sınanmadı.
            let saved = WhatsAppAccount(
                wabaId: input.wabaId,
                phoneNumberId: input.phoneNumberId,
                businessPhone: input.businessPhone,
                apiVersion: input.apiVersion ?? "v21.0",
                status: .unconfigured,
                accessTokenMasked: Self.mask(input.accessToken),
                hasAppSecret: input.appSecret?.isEmpty == false
                    || (accountRecord?.hasAppSecret ?? false),
                lastVerifiedAt: nil,
                lastError: nil
            )
            accountRecord = saved
            return saved
        }
    }

    /// Sunucudaki maskeleme ile aynı biçim: `••••••••` + son dört karakter.
    private static func mask(_ token: String) -> String {
        let tail = String(token.suffix(4))
        return "••••••••\(tail)"
    }

    func verify() async throws -> WhatsAppVerifyResult {
        await latency(0.8)
        return withLock {
            guard let account = accountRecord else {
                // Doğrulama sonucu bir hata DEĞİL: uç 200 dönüyor ve `ok: false`
                // diyor. Fırlatmak, ekranı "istek başarısız" demeye zorlardı.
                return WhatsAppVerifyResult(
                    ok: false,
                    error: "WhatsApp hesabı yapılandırılmamış",
                    templateCount: 0
                )
            }
            let approved = templateRecords.count
            accountRecord = WhatsAppAccount(
                wabaId: account.wabaId,
                phoneNumberId: account.phoneNumberId,
                businessPhone: account.businessPhone,
                apiVersion: account.apiVersion,
                status: .active,
                accessTokenMasked: account.accessTokenMasked,
                hasAppSecret: account.hasAppSecret,
                lastVerifiedAt: Date(),
                lastError: nil
            )
            return WhatsAppVerifyResult(ok: true, error: nil, templateCount: approved)
        }
    }

    func templates() async throws -> [WhatsAppTemplate] {
        await latency(0.3)
        return withLock { templateRecords }
    }

    func sendTest(_ input: SendTestMessageInput) async throws -> SendTestMessageResult {
        await latency(0.6)
        let recorded: Message = try withLock {
            guard accountRecord != nil else {
                throw permanent(.whatsappNotConfigured, "WhatsApp hesabı yapılandırılmamış")
            }
            guard let template = templateRecords.first(where: { $0.name == input.templateName })
            else {
                throw permanent(.whatsappTemplateNotApproved, "Şablon bulunamadı")
            }
            guard template.status == .approved else {
                throw permanent(.whatsappTemplateNotApproved, "Şablon Meta'da onaylı değil")
            }
            // Sunucu test gönderiminde `parameters: []` yolluyor: değişken
            // bekleyen bir şablon Meta tarafından reddedilir.
            guard template.bodyVariableCount == 0 else {
                throw permanent(
                    .whatsappTemplateNotApproved,
                    "Bu şablon \(template.bodyVariableCount) değişken bekliyor; test gönderimi parametresiz yapılır"
                )
            }
            guard Self.looksLikePhone(input.to) else {
                throw permanent(.whatsappInvalidRecipient, "Numara okunamadı")
            }
            let count = (testSendCount[input.to] ?? 0) + 1
            testSendCount[input.to] = count
            guard count < 3 else { throw rateLimited() }
            return Message(
                id: MockIDs.uuid(),
                customerId: nil,
                userId: MockIDs.userOwner,
                channel: .whatsapp,
                event: .autoReply,
                status: .sent,
                to: Self.maskPhone(input.to),
                subject: nil,
                body: "Test: \(template.name)",
                errorCode: nil,
                attempt: 1,
                scheduledFor: Date(),
                sentAt: Date(),
                deliveredAt: nil,
                createdAt: Date()
            )
        }
        messages.record(recorded)
        return SendTestMessageResult(accepted: true, providerMessageId: "wamid.\(MockIDs.uuid())")
    }

    private static func looksLikePhone(_ raw: String) -> Bool {
        let digits = raw.filter(\.isNumber)
        return digits.count >= 7 && digits.count <= 15
    }

    private static func maskPhone(_ raw: String) -> String {
        let digits = raw.filter(\.isNumber)
        guard digits.count > 4 else { return raw }
        return "+\(digits.prefix(2))\(String(repeating: "*", count: digits.count - 4))\(digits.suffix(2))"
    }

    // MARK: Gelen kutusu

    func inbox(onlyUnhandled: Bool, limit: Int?) async throws -> [InboxItem] {
        await latency(0.3)
        return withLock {
            let filtered = inboxRecords
                .filter { !onlyUnhandled || !$0.isHandled }
                .sorted { $0.receivedAt > $1.receivedAt }
            guard let limit else { return filtered }
            return Array(filtered.prefix(limit))
        }
    }

    func markInboxHandled(id: String) async throws {
        await latency()
        try withLock {
            guard let index = inboxRecords.firstIndex(where: { $0.id == id }) else {
                throw notFound()
            }
            let existing = inboxRecords[index]
            inboxRecords[index] = InboxItem(
                id: existing.id,
                customerId: existing.customerId,
                from: existing.from,
                messageType: existing.messageType,
                body: existing.body,
                receivedAt: existing.receivedAt,
                handledAt: Date()
            )
        }
    }
}
