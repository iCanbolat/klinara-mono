import SwiftUI

/// Pencere kapalıyken onaylı şablon gönderimi.
///
/// Değişkenler sunucunun önerisiyle dolu gelir (müşteri adı, şube, en yakın
/// randevu); resepsiyon düzeltir ve önizlemede müşteriye gidecek metni görür.
struct TemplateSendSheet: View {

    let store: ConversationThreadStore

    @Environment(\.dismiss) private var dismiss
    @State private var options: LoadState<[ConversationTemplateOption]> = .loading
    @State private var selectedId: String?
    @State private var values: [String] = []
    @State private var isSending = false
    @State private var error: APIError?
    /// Gönder'e boş alanla basıldı — boş alanlar kendi altında işaretlenir.
    @State private var showsMissing = false

    private var selected: ConversationTemplateOption? {
        options.value?.first { $0.id == selectedId }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    Text("Pencere kapalıyken yalnız Meta'nın onayladığı şablonlar gönderilebilir. Müşteri yanıt verdiğinde pencere yeniden açılır.")
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    content
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(KlinaraColor.surface)
            .navigationTitle("Şablon gönder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                        .disabled(isSending)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if selected != nil {
                    KlinaraButton(title: "Gönder", icon: "paperplane", isLoading: isSending) {
                        Task { await send() }
                    }
                    .padding(.horizontal, KlinaraMetrics.screenInset)
                    .padding(.vertical, KlinaraMetrics.sm)
                    .background(.bar)
                }
            }
        }
        .tint(KlinaraColor.sage)
        .interactiveDismissDisabled(isSending)
        .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        switch options {
        case .loading:
            KlinaraSkeletonBody(style: .rowsShort)
        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await load() } })
        case .loaded(let rows):
            if rows.isEmpty {
                EmptyStateView(
                    icon: "doc.text",
                    title: "Gönderilebilecek şablon yok",
                    message: "WhatsApp ayarlarından standart şablonları oluşturup Meta onayını bekleyin."
                )
            } else {
                form(rows)
            }
        }
    }

    @ViewBuilder
    private func form(_ rows: [ConversationTemplateOption]) -> some View {
        KlinaraCard(title: "Şablon") {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, option in
                if index > 0 { KlinaraDivider() }
                Button {
                    choose(option)
                } label: {
                    HStack(spacing: KlinaraMetrics.md) {
                        Image(systemName: option.id == selectedId ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(KlinaraColor.sageDeep)
                        Text(option.name)
                            .klinaraText(.bodyEmphasis)
                            .foregroundStyle(KlinaraColor.charcoal)
                        Spacer(minLength: 0)
                    }
                    .padding(KlinaraMetrics.md)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(option.id == selectedId ? .isSelected : [])
            }
        }

        if let selected {
            // Değişken alanları tek yığında, araları `md` ve hata satırı yalnız
            // hata varken: form sheet'lerinin ortak aralığı.
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
            ForEach(0..<selected.bodyVariableCount, id: \.self) { index in
                KlinaraTextField(
                    label: selected.label(at: index),
                    text: Binding(
                        get: { index < values.count ? values[index] : "" },
                        set: { value in
                            if index < values.count { values[index] = value }
                        }
                    ),
                    error: missing(at: index) ? "Bu alan zorunlu." : nil,
                    autocapitalization: .sentences
                )
            }
            }
            .environment(\.klinaraReservesFieldErrorSpace, false)

            VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
                Text("Önizleme")
                    .klinaraText(.label)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                Text(selected.render(values))
                    .klinaraText(.bodyL)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(KlinaraColor.sageSoft, in: .rect(cornerRadius: 18))
                    .accessibilityIdentifier("template-preview")
            }
        }

        if let error {
            ErrorBanner(error: error)
        }
    }

    private func missing(at index: Int) -> Bool {
        guard showsMissing else { return false }
        return index >= values.count || values[index].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func load() async {
        options = .loading
        do {
            let rows = try await store.templateOptions()
            options = .loaded(rows)
            if let first = rows.first { choose(first) }
        } catch {
            options = .failed(error as? APIError ?? .network)
        }
    }

    private func choose(_ option: ConversationTemplateOption) {
        selectedId = option.id
        values = option.suggestedParameters
        showsMissing = false
        error = nil
    }

    private func send() async {
        guard let selected else { return }
        guard selected.isComplete(values) else {
            showsMissing = true
            return
        }
        isSending = true
        error = nil
        defer { isSending = false }
        do {
            _ = try await store.sendTemplate(selected, values: values)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
