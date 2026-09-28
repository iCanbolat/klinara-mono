import SwiftUI

/// Liste içi arama alanı.
///
/// `.searchable` gezinme çubuğuna bağlı: `KlinaraScreen`in ScrollView'u ekranın
/// kök kaydırma görünümü olmadığı için çubuk kaydırılana kadar GİZLİ kalıyordu
/// ve üstüne içerik (özet şeridi) da konamıyordu. Bu alan içerikte durur ve
/// ekran açılır açılmaz görünür.
struct KlinaraSearchField: View {

    @Binding var text: String
    var placeholder = "Ara"

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: KlinaraMetrics.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(KlinaraColor.charcoalMuted)
            TextField(placeholder, text: $text)
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoal)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($isFocused)
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
                .accessibilityLabel("Aramayı temizle")
            }
        }
        .padding(.horizontal, KlinaraMetrics.md)
        .frame(height: 44)
        .background(KlinaraColor.surfaceRaised)
        .overlay(
            RoundedRectangle(cornerRadius: KlinaraMetrics.controlRadius)
                .stroke(
                    isFocused ? KlinaraColor.borderFocus : KlinaraColor.border,
                    lineWidth: isFocused ? KlinaraMetrics.focusBorderWidth : KlinaraMetrics.borderWidth
                )
        )
        .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))
        .contentShape(.rect)
        .onTapGesture { isFocused = true }
    }
}

#Preview("Arama alanı") {
    KlinaraSearchField(text: .constant(""), placeholder: "Hizmet ara")
        .padding()
        .background(KlinaraColor.surface)
}
