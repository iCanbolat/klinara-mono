import SwiftUI

/// Tüm giriş ekranlarının ortak iskeleti.
///
/// Başlık hizası, kenar boşluğu ve alt aksiyon alanı **tek yerde** tanımlıdır;
/// ekranlar arasında geçerken başlığın bir piksel kayması bu sayede imkânsız.
/// Ekranlar yalnız kendi içeriklerini ve aksiyonlarını verir.
struct AuthScaffold<Content: View, Actions: View>: View {

    var eyebrow: String?
    var title: String
    var subtitle: String?
    var showsLogo = false
    var onBack: (() -> Void)?

    @ViewBuilder var content: () -> Content
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        VStack(spacing: 0) {
            navigationBar

            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.headerToContent) {
                    header
                    content()
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.top, KlinaraMetrics.md)
                .padding(.bottom, KlinaraMetrics.xl)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)

            actionArea
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KlinaraColor.surface)
    }

    // MARK: Parçalar

    @ViewBuilder
    private var navigationBar: some View {
        HStack {
            if let onBack {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(width: 44, height: 44)
                        .contentShape(.rect)
                }
                .accessibilityLabel("Geri")
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, KlinaraMetrics.sm)
        .frame(height: 44)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
            if showsLogo {
                KlinaraLogoMark(size: 56)
                    .padding(.bottom, KlinaraMetrics.xs)
            }

            VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
                if let eyebrow {
                    Text(eyebrow)
                        .klinaraText(.label)
                        .foregroundStyle(KlinaraColor.sageDeep)
                }

                Text(title)
                    .klinaraText(.displayM)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let subtitle {
                Text(subtitle)
                    .klinaraText(.bodyL)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var actionArea: some View {
        VStack(spacing: KlinaraMetrics.sm) {
            actions()
        }
        .padding(.horizontal, KlinaraMetrics.screenInset)
        .padding(.top, KlinaraMetrics.md)
        .padding(.bottom, KlinaraMetrics.sm)
        .background(KlinaraColor.surface)
    }
}

#Preview("İskelet") {
    AuthScaffold(
        eyebrow: "Giriş",
        title: "Tekrar hoş geldiniz",
        subtitle: "Kliniğinize kayıtlı telefon numaranızla devam edin.",
        showsLogo: true,
        onBack: {}
    ) {
        KlinaraTextField(label: "Telefon numarası", text: .constant(""))
    } actions: {
        KlinaraButton(title: "Devam et") {}
        KlinaraButton(title: "E-posta ile giriş", kind: .tertiary) {}
    }
}
