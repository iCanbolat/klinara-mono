import SwiftUI

/// WABA kimlik bilgilerinin girildiği form.
///
/// **Erişim token'ı her kayıtta yeniden girilir.** Sunucu `PUT`'ta onu zorunlu
/// tutuyor ve kayıtlı değeri okumak mümkün değil (AES-256-GCM ile şifreli,
/// yanıtta yalnız maskeli hâli var). Alanı "boş bırakırsanız değişmez" gibi
/// göstermek, kaydete basınca `VALIDATION_FAILED` alan bir form olurdu; ekran
/// bunun yerine kuralı açıkça yazar.
///
/// Token ve app secret ``KlinaraTextField``ın `isSecure` kipinde girilir ve
/// hiçbir yere loglanmaz.
struct WhatsAppSettingsEditorView: View {

    let session: AppSession
    let store: WhatsAppStore

    @State private var wabaId = ""
    @State private var phoneNumberId = ""
    @State private var businessPhone = ""
    @State private var accessToken = ""
    @State private var appSecret = ""
    @State private var apiVersion = "v21.0"
    @State private var error: APIError?
    @State private var didLoad = false
    @Environment(\.dismiss) private var dismiss

    private var existing: WhatsAppAccount? { store.account }

    var body: some View {
        KlinaraFormScaffold(
            title: existing == nil ? "WhatsApp kurulumu" : "Kimlik bilgileri",
            canSave: isValid,
            isDirty: isDirty,
            isSaving: store.isSaving,
            error: error,
            onSave: { await submit() }
        ) {
            accountSection
            secretSection
            advancedSection
        }
        .task {
            guard !didLoad else { return }
            if let existing {
                wabaId = existing.wabaId
                phoneNumberId = existing.phoneNumberId
                businessPhone = existing.businessPhone ?? ""
                apiVersion = existing.apiVersion
            }
            didLoad = true
        }
    }

    private var accountSection: some View {
        KlinaraFormSection(
            title: "Hesap",
            footnote: "Bu değerler Meta Business Manager'daki WhatsApp hesabınızın ayarlar sayfasında yazılıdır."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                KlinaraTextField(
                    label: "WABA kimliği",
                    text: $wabaId,
                    placeholder: "1029384756",
                    error: error?.fieldErrors["wabaId"],
                    keyboardType: .numberPad
                )
                KlinaraTextField(
                    label: "Telefon numarası kimliği",
                    text: $phoneNumberId,
                    placeholder: "5647382910",
                    error: error?.fieldErrors["phoneNumberId"],
                    keyboardType: .numberPad
                )
                KlinaraTextField(
                    label: "İşletme numarası (isteğe bağlı)",
                    text: $businessPhone,
                    placeholder: "+902121234567",
                    error: error?.fieldErrors["businessPhone"],
                    keyboardType: .phonePad
                )
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private var secretSection: some View {
        KlinaraFormSection(
            title: "Gizli bilgiler",
            footnote: "Token ve app secret sunucuda şifreli saklanır ve hiçbir yanıtta geri dönmez."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                KlinaraTextField(
                    label: "Erişim token'ı",
                    text: $accessToken,
                    placeholder: "EAAG…",
                    error: error?.fieldErrors["accessToken"],
                    isSecure: true
                )
                if let masked = existing?.accessTokenMasked {
                    Text("Kayıtlı token okunamaz (\(masked)). Kaydetmek için token'ı yeniden girmelisiniz.")
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                KlinaraTextField(
                    label: "App secret (isteğe bağlı)",
                    text: $appSecret,
                    placeholder: existing?.hasAppSecret == true ? "Değiştirmek için doldurun" : "Meta uygulama gizli anahtarı",
                    error: error?.fieldErrors["appSecret"],
                    isSecure: true
                )
                // App secret webhook imzasını doğrular; olmadan gelen mesajlar
                // işlenmez ve gelen kutusu boş kalır.
                Text(existing?.hasAppSecret == true
                    ? "Kayıtlı bir app secret var. Boş bırakırsanız korunur."
                    : "App secret girilmeden gelen mesajlar doğrulanamaz ve gelen kutusu boş kalır.")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private var advancedSection: some View {
        KlinaraFormSection(
            title: "Gelişmiş",
            footnote: "Kaydettiğinizde bağlantı doğrulanmamış duruma döner; ardından \"Bağlantıyı doğrula\" ile sınayın."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                KlinaraTextField(
                    label: "Graph API sürümü",
                    text: $apiVersion,
                    placeholder: "v21.0",
                    error: error?.fieldErrors["apiVersion"]
                )
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private var isDirty: Bool {
        guard let existing else {
            return !wabaId.isEmpty || !phoneNumberId.isEmpty || !accessToken.isEmpty
        }
        return wabaId != existing.wabaId
            || phoneNumberId != existing.phoneNumberId
            || businessPhone != (existing.businessPhone ?? "")
            || apiVersion != existing.apiVersion
            || !accessToken.isEmpty
            || !appSecret.isEmpty
    }

    private var isValid: Bool {
        guard wabaId.count >= 3, phoneNumberId.count >= 3 else { return false }
        guard UpsertWhatsAppAccountInput.accessTokenLength.contains(accessToken.count) else {
            return false
        }
        if !appSecret.isEmpty,
           !UpsertWhatsAppAccountInput.appSecretLength.contains(appSecret.count) {
            return false
        }
        return apiVersion.wholeMatch(of: /v\d+\.\d+/) != nil
    }

    private func submit() async {
        error = nil
        do {
            _ = try await store.upsertAccount(UpsertWhatsAppAccountInput(
                wabaId: wabaId,
                phoneNumberId: phoneNumberId,
                businessPhone: businessPhone.isEmpty ? nil : businessPhone,
                accessToken: accessToken,
                appSecret: appSecret.isEmpty ? nil : appSecret,
                apiVersion: apiVersion.isEmpty ? nil : apiVersion
            ))
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
