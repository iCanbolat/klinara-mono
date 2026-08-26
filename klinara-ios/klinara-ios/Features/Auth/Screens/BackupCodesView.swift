import SwiftUI

/// Yedek kodlar — sunucu bunları **yalnız bir kez** döndürür.
///
/// Kullanıcı bu ekrandan çıktığında kodlar bir daha görünmez; bu yüzden
/// devam butonu, kullanıcı kodları kaydettiğini onaylayana kadar kapalıdır.
struct BackupCodesView: View {

    @Bindable var model: AuthFlowModel
    @State private var didAcknowledge = false
    @State private var didCopy = false

    var body: some View {
        AuthScaffold(
            eyebrow: "Güvenlik",
            title: "Yedek kodlarınız",
            subtitle: "Telefonunuzu kaybederseniz hesabınıza bu kodlarla girersiniz. Her kod bir kez kullanılır."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                codeGrid
                copyButton
                acknowledgement
            }
        } actions: {
            KlinaraButton(title: "Devam et", isEnabled: didAcknowledge) {
                model.finishBackupCodesDisplay()
            }
        }
    }

    private var codeGrid: some View {
        LazyVGrid(
            columns: [GridItem(.flexible()), GridItem(.flexible())],
            spacing: KlinaraMetrics.sm
        ) {
            ForEach(model.backupCodes, id: \.self) { code in
                Text(code)
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(KlinaraColor.charcoal)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, KlinaraMetrics.sm + 2)
                    .background(KlinaraColor.surfaceRaised)
                    .overlay(
                        RoundedRectangle(cornerRadius: KlinaraMetrics.sm)
                            .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
                    )
                    .clipShape(.rect(cornerRadius: KlinaraMetrics.sm))
            }
        }
    }

    private var copyButton: some View {
        KlinaraButton(
            title: didCopy ? "Kopyalandı" : "Tümünü kopyala",
            kind: .secondary,
            icon: didCopy ? "checkmark" : "doc.on.doc"
        ) {
            UIPasteboard.general.string = model.backupCodes.joined(separator: "\n")
            didCopy = true
        }
    }

    private var acknowledgement: some View {
        Button {
            didAcknowledge.toggle()
        } label: {
            HStack(alignment: .top, spacing: KlinaraMetrics.sm) {
                Image(systemName: didAcknowledge ? "checkmark.square.fill" : "square")
                    .font(.system(size: 20))
                    .foregroundStyle(didAcknowledge ? KlinaraColor.sage : KlinaraColor.charcoalMuted)

                Text("Kodları güvenli bir yere kaydettim.")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .multilineTextAlignment(.leading)

                Spacer(minLength: 0)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .animation(KlinaraMetrics.feedback, value: didAcknowledge)
    }
}

#Preview {
    let model = AuthFlowModel(auth: MockAuthService())
    return BackupCodesView(model: model)
}
