import SwiftUI

/// Bir ekranın veri durumu.
///
/// Yükleniyor / hata / boş / dolu ayrımını her ekranın `if isLoading … else if
/// error … else if isEmpty` zinciriyle kurması, dördünden birinin bir ekranda
/// unutulmasıyla biter (genelde boş durum).
enum LoadState<Value: Sendable>: Sendable {
    case loading
    case loaded(Value)
    case failed(APIError)

    var value: Value? {
        if case .loaded(let value) = self { return value }
        return nil
    }

    var error: APIError? {
        if case .failed(let error) = self { return error }
        return nil
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}

/// Oturum içi ekranların ortak iskeleti — ``AuthScaffold``'un karşılığı.
///
/// `AuthScaffold` giriş akışına özeldir (alt aksiyon alanı, geri oku, logo);
/// oturum açıldıktan sonraki ekranlar liste/form ekranlarıdır ve farklı bir
/// iskelet ister: kaydırılabilir gövde, üstte hata bandı, yükleme ve boş durum.
struct KlinaraScreen<Value: Sendable, Content: View>: View {

    let state: LoadState<Value>
    var emptyCheck: ((Value) -> Bool)?
    var emptyTitle = "Kayıt yok"
    var emptyMessage: String?
    var emptyIcon = "tray"
    var onRetry: (() async -> Void)?
    @ViewBuilder var content: (Value) -> Content

    var body: some View {
        ZStack {
            KlinaraColor.surface.ignoresSafeArea()

            switch state {
            case .loading:
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(KlinaraColor.sage)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .failed(let error):
                VStack(spacing: KlinaraMetrics.md) {
                    ErrorBanner(error: error, onRetry: onRetry.map { retry in
                        { Task { await retry() } }
                    })
                    Spacer(minLength: 0)
                }
                .padding(KlinaraMetrics.screenInset)

            case .loaded(let value):
                if emptyCheck?(value) == true {
                    EmptyStateView(icon: emptyIcon, title: emptyTitle, message: emptyMessage)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                            content(value)
                        }
                        .padding(.horizontal, KlinaraMetrics.screenInset)
                        .padding(.vertical, KlinaraMetrics.lg)
                    }
                    .scrollDismissesKeyboard(.interactively)
                }
            }
        }
        .animation(KlinaraMetrics.feedback, value: state.isLoading)
    }
}

/// Boş durum — Faz 3/4 sekmelerinde ve filtrelenmiş listelerde.
struct EmptyStateView: View {

    var icon = "tray"
    let title: String
    var message: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: KlinaraMetrics.md) {
            Image(systemName: icon)
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(KlinaraColor.sage.opacity(0.7))

            Text(title)
                .klinaraText(.titleM)
                .foregroundStyle(KlinaraColor.charcoal)
                .multilineTextAlignment(.center)

            if let message {
                Text(message)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let actionTitle, let action {
                KlinaraButton(title: actionTitle, kind: .secondary, action: action)
                    .padding(.top, KlinaraMetrics.sm)
                    .frame(maxWidth: 260)
            }
        }
        .padding(KlinaraMetrics.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview("Boş durum") {
    EmptyStateView(
        icon: "calendar",
        title: "Takvim yakında",
        message: "Randevu ekranları Faz 3 ile gelecek.",
        actionTitle: "Yönetime git",
        action: {}
    )
    .background(KlinaraColor.surface)
}
