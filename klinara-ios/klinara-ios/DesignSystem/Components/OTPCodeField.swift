import SwiftUI

/// Altı haneli doğrulama kodu alanı.
///
/// Görünürde altı ayrı kutu vardır ama tek bir gizli `TextField` sürer:
/// böylece yapıştırma, otomatik SMS doldurma (`.oneTimeCode`) ve geri silme
/// bedava gelir — altı ayrı alan bunların üçünü de bozar.
struct OTPCodeField: View {

    @Binding var code: String
    var digitCount = 6
    var hasError = false
    /// Kod tamamlandığında çağrılır — kullanıcı ayrıca butona basmaz.
    var onComplete: ((String) -> Void)?

    @FocusState private var isFocused: Bool

    /// Filtrelemeyi `onChange` yerine yazma anında yapar. Alanın kendi
    /// metnini `onChange` içinden yeniden yazmak, hızlı yazarken (ve SMS
    /// otomatik doldurmada) tuş vuruşlarının düşmesine yol açar.
    private var sanitized: Binding<String> {
        Binding(
            get: { code },
            set: { typed in
                let filtered = String(typed.filter(\.isNumber).prefix(digitCount))
                code = filtered
                if filtered.count == digitCount { onComplete?(filtered) }
            }
        )
    }

    var body: some View {
        ZStack {
            hiddenInput
            boxes
        }
        .frame(maxWidth: .infinity)
        .contentShape(.rect)
        .onTapGesture { isFocused = true }
        .animation(KlinaraMetrics.feedback, value: code)
        .animation(KlinaraMetrics.feedback, value: hasError)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Doğrulama kodu, \(digitCount) hane")
        .accessibilityValue(code.isEmpty ? "boş" : code.map(String.init).joined(separator: " "))
        .onAppear { isFocused = true }
    }

    private var hiddenInput: some View {
        TextField("", text: sanitized)
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .focused($isFocused)
            .opacity(0.001)          // Tam sıfır olursa bazı cihazlarda odak alamaz.
            .frame(height: 1)
    }

    private var boxes: some View {
        HStack(spacing: KlinaraMetrics.sm) {
            ForEach(0..<digitCount, id: \.self) { index in
                DigitBox(
                    character: character(at: index),
                    isActive: isFocused && index == code.count,
                    hasError: hasError
                )
            }
        }
    }

    private func character(at index: Int) -> String {
        guard index < code.count else { return "" }
        return String(code[code.index(code.startIndex, offsetBy: index)])
    }
}

private struct DigitBox: View {
    let character: String
    let isActive: Bool
    let hasError: Bool

    var body: some View {
        Text(character)
            .klinaraText(.code)
            .foregroundStyle(KlinaraColor.charcoal)
            .frame(maxWidth: .infinity)
            .frame(height: 60)
            .background(KlinaraColor.surfaceRaised)
            .overlay(
                RoundedRectangle(cornerRadius: KlinaraMetrics.controlRadius)
                    .stroke(borderColor, lineWidth: borderWidth)
            )
            .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))
    }

    private var borderColor: Color {
        if hasError { return KlinaraColor.danger }
        if isActive { return KlinaraColor.borderFocus }
        return character.isEmpty ? KlinaraColor.border : KlinaraColor.sage.opacity(0.5)
    }

    private var borderWidth: CGFloat {
        (isActive || hasError) ? KlinaraMetrics.focusBorderWidth : KlinaraMetrics.borderWidth
    }
}

#Preview("Kod alanı") {
    @Previewable @State var code = "1234"

    VStack(spacing: KlinaraMetrics.xl) {
        OTPCodeField(code: $code)
        OTPCodeField(code: .constant("000000"), hasError: true)
    }
    .padding(KlinaraMetrics.screenInset)
    .background(KlinaraColor.surface)
}
