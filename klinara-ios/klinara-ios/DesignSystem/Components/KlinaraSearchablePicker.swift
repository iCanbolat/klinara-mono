import SwiftUI

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

    @State private var term = ""

    private var visible: [Value] {
        guard !term.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return options }
        return options.filter { option in
            SearchText.matches(label(option), term: term)
                || detail(option).map { SearchText.matches($0, term: term) } ?? false
                || SearchText.matchesDigits(detail(option), term: term)
        }
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

            if visible.isEmpty {
                emptyRow
            } else {
                ForEach(Array(visible.enumerated()), id: \.element.id) { index, option in
                    if index > 0 { KlinaraDivider() }
                    row(option)
                }
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
