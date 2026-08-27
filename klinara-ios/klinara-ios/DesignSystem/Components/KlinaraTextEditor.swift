import SwiftUI

/// Çok satırlı metin alanı — notlar ve uzun açıklamalar için.
///
/// ``KlinaraTextField`` tek satırlıktır ve sabit yüksekliği vardır; 10.000
/// karaktere kadar not girilen bir alanı ona sığdırmak, kullanıcının yazdığının
/// yalnız son satırını görmesi demekti. Kenarlık, odak ve hata davranışı
/// alanınkiyle **aynı** tutuluyor: iki farklı görünen giriş kontrolü, iki farklı
/// kontrol gibi öğrenilir.
struct KlinaraTextEditor: View {

    let label: String
    @Binding var text: String
    var placeholder = ""
    var error: String?
    var minHeight: CGFloat = 120

    @FocusState private var isFocused: Bool

    private var hasError: Bool { error?.isEmpty == false }

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            Text(label)
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.charcoalMuted)

            ZStack(alignment: .topLeading) {
                // `TextEditor`ın kendi placeholder'ı yok; altına yazıp
                // metin girilince gizliyoruz.
                if text.isEmpty {
                    Text(placeholder)
                        .klinaraText(.bodyL)
                        .foregroundStyle(KlinaraColor.charcoalMuted.opacity(0.6))
                        .padding(.horizontal, KlinaraMetrics.md + 4)
                        .padding(.vertical, KlinaraMetrics.md)
                        .allowsHitTesting(false)
                }

                TextEditor(text: $text)
                    .klinaraText(.bodyL)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .textInputAutocapitalization(.sentences)
                    .scrollContentBackground(.hidden)
                    .focused($isFocused)
                    .padding(.horizontal, KlinaraMetrics.md)
                    .padding(.vertical, KlinaraMetrics.sm)
            }
            .frame(minHeight: minHeight, alignment: .topLeading)
            .background(KlinaraColor.surfaceRaised)
            .overlay(
                RoundedRectangle(cornerRadius: KlinaraMetrics.controlRadius)
                    .stroke(borderColor, lineWidth: borderWidth)
            )
            .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))

            FieldErrorText(message: error)
        }
        .animation(KlinaraMetrics.feedback, value: hasError)
        .animation(KlinaraMetrics.feedback, value: isFocused)
    }

    private var borderColor: Color {
        if hasError { return KlinaraColor.danger }
        return isFocused ? KlinaraColor.borderFocus : KlinaraColor.border
    }

    private var borderWidth: CGFloat {
        (isFocused || hasError) ? KlinaraMetrics.focusBorderWidth : KlinaraMetrics.borderWidth
    }
}
