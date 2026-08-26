import SwiftUI

/// Klinara marka işareti.
///
/// `Assets.xcassets` içinde `LogoMark` varsa **o** kullanılır. Yoksa aşağıdaki
/// vektörel yaklaşım çizilir; uygulama gerçek varlık eklenmeden de doğru
/// görünür ve asset eklendiğinde kod değişmeden ona geçer.
struct KlinaraLogoMark: View {

    var size: CGFloat = 72

    private var hasAsset: Bool {
        UIImage(named: "LogoMark") != nil
    }

    var body: some View {
        Group {
            if hasAsset {
                Image("LogoMark")
                    .resizable()
                    .scaledToFit()
            } else {
                VectorMark()
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel("Klinara")
    }
}

/// Marka işaretinin çizgisel ("line-art") yaklaşımı: sage dikey gövde,
/// gövdeyi kesen yaprak ve charcoal alt bacak.
private struct VectorMark: View {

    var body: some View {
        GeometryReader { proxy in
            let unit = min(proxy.size.width, proxy.size.height) / 100
            let stroke = 7 * unit

            ZStack {
                // K'nin dikey gövdesi — içi boş kapsül.
                Capsule()
                    .stroke(KlinaraColor.sage, lineWidth: stroke)
                    .frame(width: 22 * unit, height: 72 * unit)
                    .position(x: 34 * unit, y: 52 * unit)

                // Gövdeyi kesip aşağı süpüren yaprak sapı.
                LeafStem()
                    .stroke(
                        KlinaraColor.sage,
                        style: StrokeStyle(lineWidth: stroke, lineCap: .round)
                    )

                // Yaprak.
                Leaf()
                    .stroke(
                        KlinaraColor.sage,
                        style: StrokeStyle(lineWidth: stroke, lineCap: .round)
                    )

                // K'nin alt bacağı — charcoal, içi boş kapsül.
                Capsule()
                    .stroke(KlinaraColor.charcoal, lineWidth: stroke)
                    .frame(width: 22 * unit, height: 52 * unit)
                    .rotationEffect(.degrees(-34))
                    .position(x: 68 * unit, y: 66 * unit)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }
}

/// Yapraktan çıkıp gövdeyi çaprazlayarak sol alta inen sap.
private struct LeafStem: Shape {
    func path(in rect: CGRect) -> Path {
        let unit = min(rect.width, rect.height) / 100
        var path = Path()
        path.move(to: CGPoint(x: 58 * unit, y: 26 * unit))
        path.addCurve(
            to: CGPoint(x: 26 * unit, y: 84 * unit),
            control1: CGPoint(x: 40 * unit, y: 44 * unit),
            control2: CGPoint(x: 24 * unit, y: 62 * unit)
        )
        return path
    }
}

/// Sivri uçlu, iki yaydan oluşan yaprak.
private struct Leaf: Shape {
    func path(in rect: CGRect) -> Path {
        let unit = min(rect.width, rect.height) / 100
        let base = CGPoint(x: 48 * unit, y: 40 * unit)
        let tip = CGPoint(x: 74 * unit, y: 16 * unit)

        var path = Path()
        path.move(to: base)
        path.addQuadCurve(to: tip, control: CGPoint(x: 46 * unit, y: 16 * unit))
        path.addQuadCurve(to: base, control: CGPoint(x: 72 * unit, y: 42 * unit))
        return path
    }
}

/// İşaret + kelime markası. Giriş ekranlarının başında kullanılır.
struct KlinaraWordmark: View {

    var markSize: CGFloat = 64
    var showsMark = true

    var body: some View {
        VStack(spacing: KlinaraMetrics.md) {
            if showsMark {
                KlinaraLogoMark(size: markSize)
            }
            Text("KLINARA")
                .font(KlinaraFont.titleM)
                .tracking(6)
                .foregroundStyle(KlinaraColor.charcoal)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Klinara")
    }
}

#Preview("Logo") {
    VStack(spacing: KlinaraMetrics.xxl) {
        KlinaraLogoMark(size: 96)
        KlinaraWordmark()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(KlinaraColor.surface)
}
