import SwiftUI

/// WhatsApp entegrasyonu: hesap, doğrulama, Meta şablonları ve test gönderimi.
///
/// ``accountState`` **opsiyonel** bir değer taşır: `.loaded(nil)` "henüz
/// kurulmadı" demek ve bir hata DEĞİL. Sunucu bu durumda gövdeyi düpedüz
/// `null` döndürüyor; onu `.failed`e çevirmek kullanıcıya kurulum boş
/// durumu yerine kırmızı bir bant gösterirdi.
@MainActor
@Observable
final class WhatsAppStore {

    private let service: any WhatsAppService

    private(set) var accountState: LoadState<WhatsAppAccount?> = .loading
    private(set) var templatesState: LoadState<[WhatsAppTemplate]> = .loading
    private(set) var isSaving = false
    private(set) var isVerifying = false
    /// Son doğrulama sonucu — `ok: false` bir istek hatası değil, gösterilecek
    /// bir cevap.
    private(set) var lastVerifyResult: WhatsAppVerifyResult?

    init(service: any WhatsAppService) {
        self.service = service
    }

    var account: WhatsAppAccount? { accountState.value ?? nil }
    var templates: [WhatsAppTemplate] { templatesState.value ?? [] }

    /// Test gönderimi yalnız onaylı ve **değişkensiz** şablonla çalışır: sunucu
    /// test isteğini `parameters: []` ile yolluyor.
    var testableTemplates: [WhatsAppTemplate] { templates.filter(\.isTestable) }

    var isConfigured: Bool { account != nil }

    func loadAccount() async {
        accountState = .loading
        lastVerifyResult = nil
        do {
            accountState = .loaded(try await service.account())
        } catch {
            accountState = .failed(error as? APIError ?? .network)
        }
    }

    func loadTemplates() async {
        templatesState = .loading
        do {
            templatesState = .loaded(try await service.templates())
        } catch {
            templatesState = .failed(error as? APIError ?? .network)
        }
    }

    func upsertAccount(_ input: UpsertWhatsAppAccountInput) async throws -> WhatsAppAccount {
        isSaving = true
        defer { isSaving = false }
        let saved = try await service.upsertAccount(input)
        accountState = .loaded(saved)
        // Yeni kimlik bilgileri henüz Meta'ya karşı sınanmadı; eski doğrulama
        // sonucunu ekranda bırakmak yanlış bir güven verirdi.
        lastVerifyResult = nil
        return saved
    }

    /// Doğrulama başarısızlığı **fırlatmaz**: uç `200` ile `ok: false` döndürüyor.
    /// Sonuç ``lastVerifyResult``ta durur, hesap satırı da tazelenir.
    func verify() async throws {
        isVerifying = true
        defer { isVerifying = false }
        lastVerifyResult = try await service.verify()
        accountState = .loaded(try await service.account())
        if lastVerifyResult?.ok == true {
            await loadTemplates()
        }
    }

    func sendTest(_ input: SendTestMessageInput) async throws -> SendTestMessageResult {
        isSaving = true
        defer { isSaving = false }
        return try await service.sendTest(input)
    }
}
