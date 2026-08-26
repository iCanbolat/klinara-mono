import SwiftUI

/// Marka metin alanı: uppercase-tracked etiket + alan + hata satırı.
///
/// Hata satırı **her zaman** yer kaplar (`reservesErrorSpace`), böylece hata
/// belirdiğinde altındaki buton yer değiştirmez — kullanıcı yanlış yere basmaz.
struct KlinaraTextField: View {

    let label: String
    @Binding var text: String
    var placeholder = ""
    var error: String?
    var isSecure = false
    var textContentType: UITextContentType?
    var keyboardType: UIKeyboardType = .default
    var submitLabel: SubmitLabel = .continue
    var autocapitalization: TextInputAutocapitalization = .never
    var onSubmit: (() -> Void)?

    @FocusState private var isFocused: Bool
    @State private var isRevealed = false

    private var hasError: Bool { error?.isEmpty == false }

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            Text(label)
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.charcoalMuted)

            HStack(spacing: KlinaraMetrics.sm) {
                field
                    .klinaraText(.bodyL)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .textInputAutocapitalization(autocapitalization)
                    .autocorrectionDisabled()
                    .keyboardType(keyboardType)
                    .textContentType(textContentType)
                    .submitLabel(submitLabel)
                    .focused($isFocused)
                    .onSubmit { onSubmit?() }

                if isSecure {
                    Button {
                        isRevealed.toggle()
                    } label: {
                        Image(systemName: isRevealed ? "eye.slash" : "eye")
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                    }
                    .accessibilityLabel(isRevealed ? "Parolayı gizle" : "Parolayı göster")
                }
            }
            .padding(.horizontal, KlinaraMetrics.md)
            .frame(height: KlinaraMetrics.fieldHeight)
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

    @ViewBuilder
    private var field: some View {
        if isSecure && !isRevealed {
            SecureField(placeholder, text: $text)
        } else {
            TextField(placeholder, text: $text)
        }
    }

    private var borderColor: Color {
        if hasError { return KlinaraColor.danger }
        return isFocused ? KlinaraColor.borderFocus : KlinaraColor.border
    }

    private var borderWidth: CGFloat {
        (isFocused || hasError) ? KlinaraMetrics.focusBorderWidth : KlinaraMetrics.borderWidth
    }
}

/// Alan altındaki hata satırı. Metin yokken de yüksekliği korur.
struct FieldErrorText: View {
    let message: String?

    var body: some View {
        Text(message ?? " ")
            .klinaraText(.bodyM)
            .foregroundStyle(KlinaraColor.danger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .opacity(message == nil ? 0 : 1)
            .accessibilityHidden(message == nil)
    }
}

#Preview("Metin alanı") {
    @Previewable @State var email = ""
    @Previewable @State var password = "gizli-parola"

    VStack(spacing: KlinaraMetrics.md) {
        KlinaraTextField(
            label: "E-posta",
            text: $email,
            placeholder: "ornek@klinik.com",
            textContentType: .emailAddress,
            keyboardType: .emailAddress
        )
        KlinaraTextField(
            label: "Parola",
            text: $password,
            error: "Girdiğiniz bilgiler hatalı.",
            isSecure: true,
            textContentType: .password
        )
    }
    .padding(KlinaraMetrics.screenInset)
    .background(KlinaraColor.surface)
}
