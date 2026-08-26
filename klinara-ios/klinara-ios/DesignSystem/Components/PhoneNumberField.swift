import SwiftUI
import UIKit

/// Türkiye telefon numarası alanı.
///
/// Ekranda `5XX XXX XX XX` biçiminde maskeler, dışarıya **daima E.164**
/// (`+905XXXXXXXXX`) verir. Sunucu `phone` alanını E.164 bekler; biçimlendirme
/// tamamen sunum katmanında kalır.
struct PhoneNumberField: View {

    let label: String
    /// E.164 değer. Boş string "numara henüz tamamlanmadı" demektir.
    @Binding var e164: String
    var error: String?
    var onSubmit: (() -> Void)?

    @State private var isFocused = false

    private var hasError: Bool { error?.isEmpty == false }

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            Text(label)
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.charcoalMuted)

            HStack(spacing: 0) {
                Text("+90")
                    .klinaraText(.bodyL)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .padding(.trailing, KlinaraMetrics.sm)
                    .accessibilityHidden(true)

                Rectangle()
                    .fill(KlinaraColor.border)
                    .frame(width: 1, height: 22)
                    .padding(.trailing, KlinaraMetrics.sm)

                MaskedPhoneTextField(
                    e164: $e164,
                    isFocused: $isFocused,
                    onSubmit: onSubmit
                )
                .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, KlinaraMetrics.md)
            .frame(height: KlinaraMetrics.fieldHeight)
            .background(KlinaraColor.surfaceRaised)
            .overlay(
                RoundedRectangle(cornerRadius: KlinaraMetrics.controlRadius)
                    .stroke(borderColor, lineWidth: borderWidth)
            )
            .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(label), Türkiye, artı doksan")

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

    // MARK: - Ayrıştırma ve biçimlendirme

    /// Serbest metinden yerel 10 haneli numarayı çıkarır.
    /// `0532…`, `90532…` ve `+90 532…` yapıştırmalarını da kabul eder.
    nonisolated static func extractDigits(_ input: String) -> String {
        var raw = input.filter(\.isNumber)
        if raw.hasPrefix("90"), raw.count > 10 { raw.removeFirst(2) }
        if raw.hasPrefix("0") { raw.removeFirst() }
        return String(raw.prefix(10))
    }

    /// `5XX XXX XX XX` — 3-3-2-2 gruplama.
    nonisolated static func format(_ digits: String) -> String {
        var out = ""
        for (index, character) in digits.enumerated() {
            if index == 3 || index == 6 || index == 8 { out.append(" ") }
            out.append(character)
        }
        return out
    }

    /// Numara tamamlanmadıysa boş string döner — yarım bir numara
    /// asla sunucuya gitmez.
    nonisolated static func e164(fromDigits digits: String) -> String {
        digits.count == 10 ? "+90\(digits)" : ""
    }

    /// Özet satırlarında gösterim: `+90 532 123 45 67`.
    nonisolated static func pretty(_ e164: String) -> String {
        guard e164.hasPrefix("+90") else { return e164 }
        return "+90 " + format(extractDigits(String(e164.dropFirst(3))))
    }
}

/// Canlı maskeleme yapan UIKit alanı.
///
/// Saf SwiftUI ile yapılmıyor çünkü `TextField`, düzenleme sırasında
/// biçimlenmiş değeri geri **almaz**: `Binding`'in `get`'i yeniden okunmaz,
/// `onChange` içinden metni yeniden yazmak ise hızlı yazarken ve yapıştırmada
/// tuş vuruşlarını düşürür. `shouldChangeCharactersIn` her iki sorunu da
/// çözer — düzenleme daha uygulanmadan araya girer.
private struct MaskedPhoneTextField: UIViewRepresentable {

    @Binding var e164: String
    @Binding var isFocused: Bool
    var onSubmit: (() -> Void)?

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.delegate = context.coordinator
        field.keyboardType = .phonePad
        field.textContentType = .telephoneNumber
        field.placeholder = "5XX XXX XX XX"
        field.borderStyle = .none
        field.backgroundColor = .clear
        field.adjustsFontForContentSizeCategory = true
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.parent = self

        // Marka fontu ve rengi; Dynamic Type ile ölçeklenir.
        let base = UIFont(name: "Manrope-Regular", size: 17) ?? .systemFont(ofSize: 17)
        field.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: base)
        field.textColor = UIColor(KlinaraColor.charcoal)
        field.tintColor = UIColor(KlinaraColor.sage)

        // Dışarıdan gelen bir değeri yansıt (ör. akış geri sarıldığında).
        let expected = PhoneNumberField.format(
            PhoneNumberField.extractDigits(e164)
        )
        if !field.isFirstResponder, field.text != expected {
            field.text = expected
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: MaskedPhoneTextField

        init(parent: MaskedPhoneTextField) {
            self.parent = parent
        }

        func textField(
            _ textField: UITextField,
            shouldChangeCharactersIn range: NSRange,
            replacementString string: String
        ) -> Bool {
            let current = textField.text ?? ""
            guard let swiftRange = Range(range, in: current) else { return false }

            // Silme işleminde maskenin boşluğuna denk gelinmiş olabilir;
            // ham rakamlar üzerinden çalışmak bunu kendiliğinden çözer.
            let proposed = current.replacingCharacters(in: swiftRange, with: string)
            let digits = PhoneNumberField.extractDigits(proposed)

            textField.text = PhoneNumberField.format(digits)
            // İmleç maskenin sonunda kalır; numara sırayla girilir.
            let end = textField.endOfDocument
            textField.selectedTextRange = textField.textRange(from: end, to: end)

            parent.e164 = PhoneNumberField.e164(fromDigits: digits)
            return false
        }

        func textFieldDidBeginEditing(_ textField: UITextField) {
            parent.isFocused = true
        }

        func textFieldDidEndEditing(_ textField: UITextField) {
            parent.isFocused = false
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            parent.onSubmit?()
            return true
        }
    }
}

#Preview("Telefon alanı") {
    @Previewable @State var phone = ""

    VStack(spacing: KlinaraMetrics.md) {
        PhoneNumberField(label: "Telefon numarası", e164: $phone)
        Text(phone.isEmpty ? "— eksik —" : phone)
            .klinaraText(.bodyM)
            .foregroundStyle(KlinaraColor.charcoalMuted)
    }
    .padding(KlinaraMetrics.screenInset)
    .background(KlinaraColor.surface)
}
