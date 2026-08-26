import SwiftUI

/// Küçük durum rozeti — aktif/pasif, online, şubeye özel.
struct KlinaraBadge: View {

    enum Tone {
        case neutral, positive, warning, muted
    }

    let text: String
    var tone: Tone = .neutral
    var icon: String?

    var body: some View {
        HStack(spacing: 4) {
            if let icon {
                Image(systemName: icon).font(.system(size: 10, weight: .semibold))
            }
            Text(text)
                .font(.system(size: 11, weight: .semibold))
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, KlinaraMetrics.sm)
        .padding(.vertical, 3)
        .background(background)
        .clipShape(.capsule)
        .accessibilityLabel(text)
    }

    private var foreground: Color {
        switch tone {
        case .neutral: KlinaraColor.charcoal
        case .positive: KlinaraColor.sageDeep
        case .warning: KlinaraColor.danger
        case .muted: KlinaraColor.charcoalMuted
        }
    }

    private var background: Color {
        switch tone {
        case .neutral: KlinaraColor.border.opacity(0.4)
        case .positive: KlinaraColor.sageSoft
        case .warning: KlinaraColor.danger.opacity(0.12)
        case .muted: KlinaraColor.border.opacity(0.25)
        }
    }
}

/// Takvim rengini temsil eden nokta. Hizmet ve personel satırlarında,
/// takvimde görecekleri rengi listede de göstermek için.
struct ColorDot: View {

    let hex: String?
    var size: CGFloat = 10

    var body: some View {
        Circle()
            .fill(Color(hex: hex) ?? KlinaraColor.border)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

extension Color {
    /// `#RRGGBB` — sunucunun `COLOR_PATTERN`'i yalnız bu biçimi kabul eder.
    init?(hex: String?) {
        guard var raw = hex else { return nil }
        if raw.hasPrefix("#") { raw.removeFirst() }
        guard raw.count == 6, let value = UInt32(raw, radix: 16) else { return nil }
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }

    /// `ColorSwatchPicker` seçili rengi sunucuya geri gönderirken kullanır.
    static func hexString(for color: Color) -> String? {
        guard let components = UIColor(color).cgColor.components, components.count >= 3 else {
            return nil
        }
        let clamp = { (value: CGFloat) in Int((min(max(value, 0), 1) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", clamp(components[0]), clamp(components[1]), clamp(components[2]))
    }
}

#Preview("Rozetler") {
    HStack(spacing: KlinaraMetrics.sm) {
        KlinaraBadge(text: "Aktif", tone: .positive)
        KlinaraBadge(text: "Pasif", tone: .muted)
        KlinaraBadge(text: "Online", tone: .neutral, icon: "globe")
        KlinaraBadge(text: "Şubeye özel", tone: .warning)
        ColorDot(hex: "#7F9A76")
    }
    .padding()
    .background(KlinaraColor.surface)
}
