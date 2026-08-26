import SwiftUI

/// Kart içinde bir anahtar satırı.
///
/// **Satırın tamamı dokunulabilir.** Anahtarı tek başına dokunulabilir bırakmak
/// iki sorun üretiyordu: hedef alanı 51×31pt ile Apple'ın 44pt tavsiyesinin
/// altında kalıyor, ve kart içindeki katmanlanmayla dokunuşlar anahtara
/// ulaşmıyordu. iOS Ayarlar'da da satırın tamamı çalışır.
struct KlinaraToggleRow: View {

    let label: String
    var detail: String?
    @Binding var isOn: Bool
    var isEnabled = true

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(alignment: .center, spacing: KlinaraMetrics.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .klinaraText(.bodyM)
                        .foregroundStyle(isEnabled ? KlinaraColor.charcoal : KlinaraColor.charcoalMuted)
                        .multilineTextAlignment(.leading)

                    if let detail {
                        Text(detail)
                            .klinaraText(.bodyM)
                            .font(.footnote)
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                // Yalnız gösterge: dokunuşu satırın Button'ı karşılıyor.
                // Anahtarın kendisi de dokunuşu yakalasaydı iki kez tetiklenirdi.
                Toggle("", isOn: $isOn)
                    .labelsHidden()
                    .tint(KlinaraColor.sage)
                    .allowsHitTesting(false)
            }
            .padding(KlinaraMetrics.md)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityLabel(label)
        .accessibilityValue(isOn ? "Açık" : "Kapalı")
        .accessibilityHint(detail ?? "")
        .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
    }
}

/// Dakika cinsinden süre girişi — hizmet süresi ve hazırlık/temizlik payı.
///
/// Serbest metin yerine adımlı seçici: buffer değerleri küçük ve kısıtlı
/// (`0…240`), klavye açmak burada kullanıcıyı yavaşlatır.
struct KlinaraStepperRow: View {

    let label: String
    var detail: String?
    @Binding var value: Int
    var range: ClosedRange<Int> = 0...240
    var step = 5
    var isEnabled = true
    /// Değerin nasıl gösterileceği — süre "1 sa 30 dk", sayı ise düz.
    var format: (Int) -> String = { "\($0) dk" }

    var body: some View {
        HStack(alignment: .center, spacing: KlinaraMetrics.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoal)

                if let detail {
                    Text(detail)
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityHidden(true)

            Text(format(value))
                .klinaraText(.bodyEmphasis)
                .foregroundStyle(KlinaraColor.charcoal)
                .monospacedDigit()
                .frame(minWidth: 76, alignment: .trailing)
                .accessibilityHidden(true)

            Stepper("", value: $value, in: range, step: step)
                .labelsHidden()
                .disabled(!isEnabled)
                .accessibilityLabel(label)
                .accessibilityValue(format(value))
        }
        .padding(KlinaraMetrics.md)
        // `.combine` burada da yoktu edilemez — bkz. ``KlinaraToggleRow``
        // içindeki not: Stepper'ın artı/eksi düğmelerini etkisiz kılıyordu.
    }
}

/// Kuruş cinsinden para girişi.
///
/// Değer `Int` (kuruş) olarak dışarı verilir; ekranlar hiçbir yerde `Double`
/// görmez. Alan boşken `nil` döner — "0 TL" ile "belirtilmemiş" farklı şeyler,
/// özellikle şube override'larında.
struct KlinaraMoneyField: View {

    let label: String
    @Binding var amountMinor: Int?
    var placeholder = "0,00"
    var error: String?
    /// Şube override'larında "boş bırakılırsa hizmetin fiyatı geçerli" notu.
    var footnote: String?

    @State private var text = ""
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            KlinaraTextField(
                label: label,
                text: $text,
                placeholder: placeholder,
                error: error,
                keyboardType: .decimalPad
            )
            .focused($isFocused)

            if let footnote, error == nil {
                Text(footnote)
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }
        }
        .onAppear { syncFromValue() }
        .onChange(of: text) { _, newValue in
            amountMinor = newValue.trimmingCharacters(in: .whitespaces).isEmpty
                ? nil
                : Money.parse(newValue)
        }
        .onChange(of: isFocused) { _, focused in
            // Odak çıkınca kullanıcının yazdığını kanonik biçime çeviriyoruz
            // ("1500" → "1.500,00"). Yazarken yapmak imleci zıplatırdı.
            if !focused { syncFromValue() }
        }
    }

    private func syncFromValue() {
        text = amountMinor.map(Money.formatPlain) ?? ""
    }
}

/// `HH:mm` saat seçici — şube çalışma saatleri ve personel şablonu.
struct KlinaraTimeField: View {

    let label: String
    @Binding var time: ClockTime?
    var isEnabled = true
    /// Şube saat dilimi; seçici bu dilimde çalışır.
    var timeZone: TimeZone = .current

    var body: some View {
        DatePicker(
            label,
            selection: Binding(
                get: { referenceDate(for: time ?? .nineAM) },
                set: { time = clockTime(from: $0) }
            ),
            displayedComponents: .hourAndMinute
        )
        .datePickerStyle(.compact)
        .environment(\.timeZone, timeZone)
        .klinaraText(.bodyM)
        .foregroundStyle(isEnabled ? KlinaraColor.charcoal : KlinaraColor.charcoalMuted)
        .disabled(!isEnabled)
        .padding(KlinaraMetrics.md)
    }

    /// Saat seçicinin bir `Date`'e ihtiyacı var; günün kendisi anlamsız olduğu
    /// için sabit bir referans gün kullanıyoruz — yaz saati geçiş gününe denk
    /// gelen bir gün seçilirse 02:00 gibi var olmayan saatler kayardı.
    private func referenceDate(for time: ClockTime) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        var components = DateComponents()
        components.year = 2001
        components.month = 1
        components.day = 1
        components.hour = time.hour
        components.minute = time.minute
        return calendar.date(from: components) ?? Date()
    }

    private func clockTime(from date: Date) -> ClockTime {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let components = calendar.dateComponents([.hour, .minute], from: date)
        return ClockTime(hour: components.hour ?? 9, minute: components.minute ?? 0)
    }
}

/// Serbest etiket girişi — personel uzmanlıkları.
struct KlinaraTagField: View {

    let label: String
    @Binding var tags: [String]
    var placeholder = "Ekleyip Enter'a basın"

    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            KlinaraTextField(
                label: label,
                text: $draft,
                placeholder: placeholder,
                submitLabel: .done,
                autocapitalization: .words,
                onSubmit: commit
            )

            if !tags.isEmpty {
                FlowLayout(spacing: KlinaraMetrics.sm) {
                    ForEach(tags, id: \.self) { tag in
                        Button {
                            tags.removeAll { $0 == tag }
                        } label: {
                            KlinaraBadge(text: tag, tone: .positive, icon: "xmark")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(tag) etiketini kaldır")
                    }
                }
            }
        }
    }

    private func commit() {
        let value = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !tags.contains(value) else {
            draft = ""
            return
        }
        tags.append(value)
        draft = ""
    }
}

/// Satıra sığdıkça yan yana, sığmayınca alt satıra geçen yerleşim.
struct FlowLayout: Layout {

    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var origin = CGPoint.zero
        var lineHeight: CGFloat = 0
        var maxWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if origin.x + size.width > width, origin.x > 0 {
                origin.x = 0
                origin.y += lineHeight + spacing
                lineHeight = 0
            }
            origin.x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
            maxWidth = max(maxWidth, origin.x - spacing)
        }
        return CGSize(width: maxWidth, height: origin.y + lineHeight)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        var origin = bounds.origin
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if origin.x + size.width > bounds.maxX, origin.x > bounds.minX {
                origin.x = bounds.minX
                origin.y += lineHeight + spacing
                lineHeight = 0
            }
            subview.place(at: origin, proposal: ProposedViewSize(size))
            origin.x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
