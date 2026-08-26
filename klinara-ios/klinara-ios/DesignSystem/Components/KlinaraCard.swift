import SwiftUI

/// Gruplu içerik kartı — liste satırlarının, form bölümlerinin ve bilgi
/// bloklarının ortak zemini.
///
/// `HomePlaceholderView`'da elle kurulan zemin + kenarlık + köşe yarıçapı
/// üçlüsü buraya taşındı; ekranların bunu tekrar kurması, birinin bir gün
/// 12pt yarıçap yazması demekti.
struct KlinaraCard<Content: View>: View {

    var title: String?
    var footnote: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            if let title {
                Text(title)
                    .klinaraText(.label)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .padding(.horizontal, KlinaraMetrics.xs)
            }

            VStack(spacing: 0) {
                content()
            }
            .background(KlinaraColor.surfaceRaised)
            .overlay(
                RoundedRectangle(cornerRadius: KlinaraMetrics.cardRadius)
                    .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
            )
            .clipShape(.rect(cornerRadius: KlinaraMetrics.cardRadius))

            if let footnote {
                Text(footnote)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, KlinaraMetrics.xs)
            }
        }
    }
}

/// Kart içindeki satır ayracı. Son satırdan sonra çizilmez.
struct KlinaraDivider: View {
    var body: some View {
        Rectangle()
            .fill(KlinaraColor.border)
            .frame(height: KlinaraMetrics.borderWidth)
            .padding(.leading, KlinaraMetrics.md)
    }
}

/// Kart içi satır: etiket, değer ve isteğe bağlı aksesuar.
struct KlinaraRow<Accessory: View>: View {

    let label: String
    var value: String?
    var detail: String?
    var isMonospaced = false
    @ViewBuilder var accessory: () -> Accessory

    var body: some View {
        HStack(alignment: .center, spacing: KlinaraMetrics.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let detail {
                    Text(detail)
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            if let value {
                Text(value)
                    .klinaraText(.bodyM)
                    .font(isMonospaced ? .system(.footnote, design: .monospaced) : nil)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .multilineTextAlignment(.trailing)
            }

            accessory()
        }
        .padding(KlinaraMetrics.md)
        .contentShape(.rect)
    }
}

extension KlinaraRow where Accessory == EmptyView {
    init(label: String, value: String? = nil, detail: String? = nil, isMonospaced: Bool = false) {
        self.init(
            label: label,
            value: value,
            detail: detail,
            isMonospaced: isMonospaced,
            accessory: { EmptyView() }
        )
    }
}

/// Detay ekranına götüren satır.
struct KlinaraNavigationRow<Destination: View>: View {

    let label: String
    var value: String?
    var detail: String?
    var icon: String?
    @ViewBuilder var destination: () -> Destination

    var body: some View {
        NavigationLink(destination: destination) {
            HStack(spacing: KlinaraMetrics.md) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(KlinaraColor.sageDeep)
                        .frame(width: 24)
                }

                KlinaraRow(label: label, value: value, detail: detail) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
                .padding(.leading, icon == nil ? 0 : -KlinaraMetrics.md)
            }
            .padding(.leading, icon == nil ? 0 : KlinaraMetrics.md)
        }
        .buttonStyle(.plain)
    }
}

#Preview("Kart") {
    ScrollView {
        VStack(spacing: KlinaraMetrics.lg) {
            KlinaraCard(title: "Oturum") {
                KlinaraRow(label: "Klinik", value: "Demo Estetik")
                KlinaraDivider()
                KlinaraRow(label: "Şube", value: "Nişantaşı")
                KlinaraDivider()
                KlinaraRow(label: "Rol", value: "Yönetici")
            }

            KlinaraCard(title: "Katalog", footnote: "Pasif hizmetler listede görünmez.") {
                KlinaraNavigationRow(
                    label: "Hizmetler",
                    value: "6",
                    detail: "Süre, fiyat ve hazırlık payı",
                    icon: "list.bullet.rectangle"
                ) { Text("Hizmetler") }
            }
        }
        .padding(KlinaraMetrics.screenInset)
    }
    .background(KlinaraColor.surface)
}
