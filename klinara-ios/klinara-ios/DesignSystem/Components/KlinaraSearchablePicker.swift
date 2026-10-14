import SwiftUI

/// Bu eşiğin altında (ör. hizmet, paket) liste zaten göz atılabilir boyutta —
/// tamamı doğrudan gösterilir. Üstünde (ör. yüzlerce müşteri) boş aramada tam
/// listeyi basmak ekranı dolduruyor ve göz atılamaz hâle geliyordu; kullanıcı
/// yazmaya başlayana kadar liste gizlenir.
///
/// Genel (generic) tipte `static let` desteklenmediği için sabit tip dışına
/// alındı.
private let searchablePickerCollapseThreshold = 8

/// Aranabilir tek seçim listesi — müşteri, personel, hizmet seçimi.
///
/// `ScheduleExceptionEditorView` bunu elle kuruyordu ve arama alanı yoktu;
/// iki personelde sorun değil, iki yüz müşteride kullanılamaz.
///
/// Boş sonuç durumunda "yeni kayıt" eylemi sunulabilir (``createLabel``):
/// randevu alırken müşteriyi bulamayan kullanıcıyı ekrandan çıkarmamak,
/// akışın en sık kırıldığı noktayı kapatıyor.
struct KlinaraSearchablePicker<Value: Identifiable>: View {

    let title: String
    let options: [Value]
    let label: (Value) -> String
    var detail: (Value) -> String? = { _ in nil }
    let isSelected: (Value) -> Bool
    let onSelect: (Value) -> Void

    var searchPrompt = "Ara"
    var emptyMessage = "Sonuç yok."
    var createLabel: String?
    var onCreate: (() -> Void)?
    /// `options` sunucudaki kümenin yalnız bir sayfasıysa (müşteriler) verilir:
    /// terim sunucuda da aranır ve sonuç yerel eşleşmelere eklenir. Yoksa
    /// ilk sayfada olmayan kayıt hiçbir aramayla bulunamıyordu.
    var remoteSearch: ((String) async -> [Value])?
    /// Liste bu kadar karakter yazılana kadar açılmaz (`0` → eşik yok).
    ///
    /// Müşteri seçiminde bir iki harf yüzlerce kaydı eşliyor ve her tuşta
    /// sunucuya arama gidiyordu; üç harf hem sonucu daraltıyor hem isteği
    /// anlamlı kılıyor.
    var minSearchLength = 0
    /// Verilirse sonuçlar bu SABİT yükseklikte, kendi içinde kayan bir alanda
    /// çizilir. Uzun bir sonuç listesi formun geri kalanını (hizmet, saat)
    /// ekranın çok altına itiyordu; sabit yükseklik yazarken alanın boyunun
    /// da zıplamasını önlüyor.
    var resultsHeight: CGFloat?

    @State private var term = ""
    @State private var remote: [Value] = []
    /// Sunucu araması sürüyor. Yerel sayfada eşleşme yokken sonuç gelmeden
    /// "Eşleşen müşteri yok" demek, birazdan gelecek kaydı yok gibi gösteriyordu.
    @State private var isSearchingRemote = false

    private var trimmedTerm: String {
        term.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isCollapsed: Bool {
        trimmedTerm.isEmpty && options.count > searchablePickerCollapseThreshold
    }

    /// Eşik verilmiş ve henüz ona ulaşılmamış — boş terim dahil.
    private var isBelowMinLength: Bool {
        minSearchLength > 0 && trimmedTerm.count < minSearchLength
    }

    private var visible: [Value] {
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return isCollapsed ? [] : options }
        let local = options.filter { option in
            SearchText.matches(label(option), term: term)
                || detail(option).map { SearchText.matches($0, term: term) } ?? false
                || SearchText.matchesDigits(detail(option), term: term)
        }
        let known = Set(local.map(\.id))
        return local + remote.filter { !known.contains($0.id) }
    }

    var body: some View {
        KlinaraFormSection(title: title) {
            // Etiket "Ara": `searchPrompt` zaten placeholder olarak duruyor ve
            // kartın başlığı ("Müşteri") neyin arandığını söylüyor.
            KlinaraTextField(
                label: "Ara",
                text: $term,
                placeholder: searchPrompt,
                autocapitalization: .words
            )
            .padding(.horizontal, KlinaraMetrics.md)
            .padding(.top, KlinaraMetrics.sm)

            if isBelowMinLength {
                minLengthHint
            } else if isCollapsed {
                collapsedHint
            } else if visible.isEmpty && isSearchingRemote {
                hintRow("Aranıyor…")
            } else if visible.isEmpty {
                emptyRow
            } else if let resultsHeight {
                ScrollView {
                    LazyVStack(spacing: 0) { rows }
                }
                .frame(height: resultsHeight)
                .scrollBounceBehavior(.basedOnSize)
            } else {
                rows
            }

            if let createLabel, let onCreate {
                KlinaraDivider()
                Button(action: onCreate) {
                    KlinaraRow(label: createLabel) {
                        Image(systemName: "plus.circle")
                            .foregroundStyle(KlinaraColor.sageDeep)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .task(id: term) {
            guard let remoteSearch else { return }
            let trimmed = trimmedTerm
            guard trimmed.count >= max(2, minSearchLength) else {
                remote = []
                isSearchingRemote = false
                return
            }
            isSearchingRemote = true
            // Her tuşa bir istek atılmasın; terim değişince görev iptal olur.
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            let found = await remoteSearch(trimmed)
            guard !Task.isCancelled else { return }
            remote = found
            isSearchingRemote = false
        }
    }

    @ViewBuilder
    private var rows: some View {
        ForEach(Array(visible.enumerated()), id: \.element.id) { index, option in
            if index > 0 { KlinaraDivider() }
            row(option)
        }
    }

    private var minLengthHint: some View {
        hintRow("Aramak için en az \(minSearchLength) karakter yazın.")
    }

    private func hintRow(_ text: String) -> some View {
        Text(text)
            .klinaraText(.bodyM)
            .foregroundStyle(KlinaraColor.charcoalMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(KlinaraMetrics.md)
    }

    private var collapsedHint: some View {
        Text("\(options.count) kayıt var. Bulmak için yazın.")
            .klinaraText(.bodyM)
            .foregroundStyle(KlinaraColor.charcoalMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(KlinaraMetrics.md)
    }

    private var emptyRow: some View {
        Text(emptyMessage)
            .klinaraText(.bodyM)
            .foregroundStyle(KlinaraColor.charcoalMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(KlinaraMetrics.md)
    }

    private func row(_ option: Value) -> some View {
        Button {
            onSelect(option)
        } label: {
            KlinaraRow(label: label(option), detail: detail(option)) {
                if isSelected(option) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(KlinaraColor.sageDeep)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected(option) ? [.isButton, .isSelected] : .isButton)
    }
}

#Preview("Aranabilir seçici") {
    struct Item: Identifiable { let id: String; let name: String; let phone: String }
    let items = [
        Item(id: "1", name: "Ayşe Yılmaz", phone: "+90 532 111 22 33"),
        Item(id: "2", name: "Mehmet Demir", phone: "+90 532 444 55 66"),
    ]
    return ScrollView {
        KlinaraSearchablePicker(
            title: "Müşteri",
            options: items,
            label: \.name,
            detail: { $0.phone },
            isSelected: { $0.id == "1" },
            onSelect: { _ in },
            searchPrompt: "Müşteri ara",
            createLabel: "Yeni müşteri ekle",
            onCreate: {}
        )
        .padding(KlinaraMetrics.screenInset)
    }
    .background(KlinaraColor.surface)
}
