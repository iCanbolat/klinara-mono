import SwiftUI

/// Sıfırlama isteği sonrası **nötr** onay.
///
/// Metin bilinçli olarak "bu e-posta kayıtlıysa" der. Sunucu da adresin
/// kayıtlı olup olmadığını ayırt etmeden aynı yanıtı döndürür; arayüzün
/// "böyle bir hesap yok" demesi bu ucu bir hesap numaralandırma aracına
/// çevirirdi.
struct ForgotPasswordSentView: View {

    @Bindable var model: AuthFlowModel

    var body: some View {
        AuthScaffold(
            eyebrow: "Kurtarma",
            title: "Bağlantıyı gönderdik",
            subtitle: "\(model.forgotPasswordEmail) adresi kayıtlıysa sıfırlama bağlantısı gönderildi. Gelen kutunuzu kontrol edin."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                Label(
                    "Bağlantı 1 saat geçerlidir ve yalnızca bir kez kullanılabilir.",
                    systemImage: "clock"
                )
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoalMuted)

                Label(
                    "E-posta gelmediyse spam klasörünü kontrol edin veya klinik yöneticinizle iletişime geçin.",
                    systemImage: "questionmark.circle"
                )
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoalMuted)
            }
        } actions: {
            KlinaraButton(title: "Girişe dön") {
                model.goBack()
            }
        }
    }
}

#Preview {
    let model = AuthFlowModel(services: .mock())
    model.forgotPasswordEmail = "ayse.yilmaz@klinik.com"
    return ForgotPasswordSentView(model: model)
}
