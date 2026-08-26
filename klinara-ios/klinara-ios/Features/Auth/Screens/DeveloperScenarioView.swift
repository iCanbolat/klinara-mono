import SwiftUI

/// Mock senaryo seçici.
///
/// Hem `HomePlaceholderView` içinden hem de giriş ekranından (logoya uzun
/// basarak) açılır. Giriş ekranından da erişilebilir olması şart: "hatalı
/// bilgi" ya da "hesap kilitli" senaryosundayken giriş yapılamaz, dolayısıyla
/// yalnız ana ekranda duran bir seçici kullanıcıyı o senaryoda kilitler.
struct DeveloperScenarioList: View {

    let mock: MockAuthService
    var onSelect: (MockScenario) -> Void

    @State private var selection: MockScenario

    init(mock: MockAuthService, onSelect: @escaping (MockScenario) -> Void) {
        self.mock = mock
        self.onSelect = onSelect
        _selection = State(initialValue: mock.scenario)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
            Text("Senaryo")
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.charcoalMuted)

            ForEach(MockScenario.allCases) { scenario in
                Button {
                    selection = scenario
                    onSelect(scenario)
                } label: {
                    HStack {
                        Text(scenario.rawValue)
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.charcoal)
                        Spacer()
                        if selection == scenario {
                            Image(systemName: "checkmark")
                                .foregroundStyle(KlinaraColor.sage)
                        }
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }

            Rectangle()
                .fill(KlinaraColor.border)
                .frame(height: 1)

            // Fontların gerçekten paketlendiğini doğrular; sessizce sistem
            // fontuna düşmüş olmayı yakalar.
            Text("Fontlar")
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.charcoalMuted)

            Text(KlinaraFont.diagnostics)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(
                    KlinaraFont.allInstalled ? KlinaraColor.charcoalMuted : KlinaraColor.danger
                )
        }
    }
}

/// Giriş ekranından açılan sarmalayıcı.
struct DeveloperScenarioSheet: View {

    let mock: MockAuthService
    var onSelect: (MockScenario) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                DeveloperScenarioList(mock: mock) { scenario in
                    onSelect(scenario)
                    dismiss()
                }
                .padding(KlinaraMetrics.screenInset)
            }
            .background(KlinaraColor.surface)
            .navigationTitle("Geliştirici")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Kapat") { dismiss() }
                        .foregroundStyle(KlinaraColor.sageDeep)
                }
            }
        }
        .tint(KlinaraColor.sage)
        .presentationDetents([.medium, .large])
    }
}
