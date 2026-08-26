import SwiftUI

/// Kullanıcı birden çok klinikte üyeyse kiracı seçimi.
///
/// Bu adımda henüz **oturum yoktur** — elde yalnız ara token vardır.
/// Kiracı seçilmeden hiçbir veriye erişim verilmez.
struct TenantSelectView: View {

    @Bindable var model: AuthFlowModel

    var body: some View {
        AuthScaffold(
            eyebrow: "Klinik",
            title: "Hangi klinik?",
            subtitle: "Birden çok klinikte kayıtlısınız. Devam etmek için birini seçin."
        ) {
            VStack(spacing: KlinaraMetrics.sm) {
                if let error = model.error {
                    ErrorBanner(error: error)
                }

                ForEach(model.tenants) { tenant in
                    SelectionRow(
                        title: tenant.name,
                        subtitle: tenant.roles.map(RoleName.turkish).joined(separator: " · "),
                        isBusy: model.isBusy
                    ) {
                        Task { await model.selectTenant(tenant) }
                    }
                }
            }
        } actions: {
            KlinaraButton(title: "Çıkış yap", kind: .tertiary) {
                Task { await model.logout() }
            }
        }
    }
}

/// Rol anahtarlarının Türkçe karşılıkları. Sunucu `roleName` de döndürür ama
/// kiracı seçimi yanıtında yalnız `roles` (anahtarlar) gelir.
enum RoleName {
    nonisolated static func turkish(_ key: String) -> String {
        switch key {
        case "owner": "Sahip"
        case "manager": "Yönetici"
        case "receptionist": "Resepsiyon"
        case "practitioner": "Uygulayıcı"
        case "accountant": "Muhasebe"
        case "platform_admin": "Platform yöneticisi"
        default: key
        }
    }
}

/// Liste seçim satırı — kiracı ve şube ekranlarının ortak bileşeni.
struct SelectionRow: View {

    let title: String
    var subtitle: String?
    var isBusy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: KlinaraMetrics.md) {
                VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
                    Text(title)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .multilineTextAlignment(.leading)

                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .multilineTextAlignment(.leading)
                    }
                }

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }
            .padding(KlinaraMetrics.md)
            .frame(maxWidth: .infinity)
            .background(KlinaraColor.surfaceRaised)
            .overlay(
                RoundedRectangle(cornerRadius: KlinaraMetrics.cardRadius)
                    .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
            )
            .clipShape(.rect(cornerRadius: KlinaraMetrics.cardRadius))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(isBusy)
        .opacity(isBusy ? 0.6 : 1)
    }
}

#Preview {
    let model = AuthFlowModel(services: .mock(scenario: .multiTenant))
    return TenantSelectView(model: model)
}
