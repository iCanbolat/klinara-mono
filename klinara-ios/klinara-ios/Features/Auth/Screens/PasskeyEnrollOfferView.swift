import SwiftUI

/// Parolayla giriş yapıldıktan sonra bir kez gösterilen passkey teklifi.
///
/// Passkey oltalamaya **yapısal olarak** dayanıklıdır: imza `rpId`'ye
/// bağlıdır, sahte bir alan adı geçerli imza üretemez. Biyometri yalnızca
/// kullanıcının gördüğü yüzüdür; asıl kazanç budur.
struct PasskeyEnrollOfferView: View {

    @Bindable var model: AuthFlowModel

    var body: some View {
        AuthScaffold(
            eyebrow: "Bir adım kaldı",
            title: "Bir dahaki sefere tek dokunuş",
            subtitle: "\(model.biometry.displayName) ile parolanızı yazmadan girin. Anahtarınız cihazınızın güvenli donanımında kalır, klinik sunucusuna gitmez."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let error = model.error {
                    ErrorBanner(error: error)
                }

                biometryBadge

                VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                    benefit("bolt", "Parola yazmadan, tek dokunuşta giriş")
                    benefit("lock.shield", "Sahte siteler anahtarınızı kullanamaz")
                    benefit("iphone.and.arrow.forward", "Özel anahtar cihazdan hiç çıkmaz")
                }
            }
        } actions: {
            KlinaraButton(
                title: "\(model.biometry.displayName) ile kur",
                icon: model.biometry.symbolName
            ) {
                Task { await model.enrollPasskey() }
            }

            KlinaraButton(title: "Daha sonra", kind: .tertiary) {
                model.skipPasskeyEnrollment()
            }
        }
    }

    private var biometryBadge: some View {
        HStack {
            Spacer()
            Image(systemName: model.biometry.symbolName)
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(KlinaraColor.sage)
                .frame(width: 96, height: 96)
                .background(KlinaraColor.sageSoft)
                .clipShape(.circle)
            Spacer()
        }
        .accessibilityHidden(true)
    }

    private func benefit(_ symbol: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: KlinaraMetrics.md) {
            Image(systemName: symbol)
                .font(.system(size: 16))
                .foregroundStyle(KlinaraColor.sageDeep)
                .frame(width: 22)

            Text(text)
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoal)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
    }
}

#Preview {
    PasskeyEnrollOfferView(model: AuthFlowModel(auth: MockAuthService()))
}
