import SwiftUI

/// Sürükleyerek sıralanan kart listesi.
///
/// Her öğe kendi kartıdır ve solunda bir **tutamaç** taşır: sıralanabilir
/// olduğu, satırı "basılı tutup" aramak zorunda kalmadan görünür. Tutamaca
/// dokunmak satırı kaldırır (hafif büyür, gölge alır, haptic verir), parmakla
/// birlikte hareket eder; diğer kartlar yol açmak için yumuşakça kayar ve
/// bırakınca satır boşalan yuvaya oturur.
///
/// Sürükleme sırasında dizilim DEĞİŞMEZ; yalnız ofsetler oynar. Dizilimi canlı
/// değiştirmek, sürüklenen satırın koordinatını her adımda yeniden hesaplatıp
/// animasyonları birbirine karıştırıyordu. Yeni sıra yalnız bırakılınca
/// [onMove] ile bildirilir; çağıran onu HEMEN uygular (iyimser) ve [items]
/// artık yeni sırada gelir — böylece ara bir "eski sıra" karesi çizilmez.
///
/// Otomatik kaydırma yok: kart sayısı birkaç ekranı geçmeyen listeler için
/// tasarlandı (kategori gibi).
struct KlinaraReorderableList<Item: Identifiable, Row: View>: View {

    let items: [Item]
    /// Tutamaçların görünmesi (yetki).
    var isEnabled = true
    /// Tutamaç görünür kalır ama sürüklenemez — kaydetme sürerken düzen
    /// oynamasın diye `isEnabled`i kapatmak yerine bu kullanılır.
    var isLocked = false
    var spacing: CGFloat = KlinaraMetrics.sm
    /// Bırakıldıktan sonraki tam sıra (kimlikler).
    let onMove: ([Item.ID]) -> Void
    @ViewBuilder var row: (Item) -> Row

    private struct Drag {
        let id: Item.ID
        let startIndex: Int
        var translation: CGFloat
    }

    @State private var drag: Drag?
    @State private var rowHeight: CGFloat = 0

    private static var settle: Animation { .snappy(duration: 0.25) }
    private var stride: CGFloat { max(rowHeight + spacing, 1) }

    var body: some View {
        VStack(spacing: spacing) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                card(for: item, at: index)
            }
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: drag?.id != nil)
        .sensoryFeedback(.selection, trigger: targetIndex)
    }

    // MARK: Kart

    private func card(for item: Item, at index: Int) -> some View {
        let isLifted = drag?.id == item.id
        let offset = offset(forIndex: index, isLifted: isLifted)

        return KlinaraCard {
            HStack(spacing: 0) {
                if isEnabled {
                    handle(for: item, at: index)
                }
                row(item)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
            // Kartlar aynı yükseklikte varsayılır; ilkinin ölçüsü yeter.
            if index == 0, drag == nil { rowHeight = height }
        }
        .scaleEffect(isLifted ? 1.02 : 1)
        .shadow(
            color: .black.opacity(isLifted ? 0.16 : 0),
            radius: isLifted ? 14 : 0,
            y: isLifted ? 8 : 0
        )
        .offset(y: offset)
        // Kalkma/iniş animasyonu. Kaldırılmış satırın ofseti animasyonsuz: parmağı
        // gecikmeden izlemeli. Komşular yol açarken kayar.
        .animation(Self.settle, value: isLifted)
        .animation(isLifted ? nil : Self.settle, value: offset)
        .zIndex(isLifted ? 1 : 0)
    }

    // MARK: Tutamaç

    private func handle(for item: Item, at index: Int) -> some View {
        Image(systemName: "line.3.horizontal")
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(drag?.id == item.id ? KlinaraColor.sageDeep : KlinaraColor.charcoalMuted)
            .opacity(isLocked ? 0.4 : 1)
            .frame(width: 48)
            .frame(maxHeight: .infinity)
            .contentShape(.rect)
            // Genişlik-yükseklik dokunma alanı 44pt'in üstünde. Tutamaç
            // VoiceOver'a gösterilmez: sıralamanın erişilebilir yolu satırın
            // "Yukarı/Aşağı taşı" aksiyonları.
            .accessibilityHidden(true)
            .gesture(dragGesture(for: item, startIndex: index), including: isLocked ? .none : .all)
    }

    private func dragGesture(for item: Item, startIndex: Int) -> some Gesture {
        // `.global`: yerel uzayda satırın kendisi hareket ettiği için ölçüm
        // parmakla birlikte kayar ve ofset geri beslemeyle titrerdi.
        DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .onChanged { value in
                if drag == nil {
                    drag = Drag(id: item.id, startIndex: startIndex, translation: 0)
                }
                let lower = -CGFloat(startIndex) * stride
                let upper = CGFloat(items.count - 1 - startIndex) * stride
                drag?.translation = min(max(value.translation.height, lower), upper)
            }
            .onEnded { _ in drop() }
    }

    // MARK: Yerleşim

    /// Bırakılırsa satırın gideceği dizin.
    private var targetIndex: Int? {
        guard let drag else { return nil }
        let shift = Int((drag.translation / stride).rounded())
        return min(max(drag.startIndex + shift, 0), items.count - 1)
    }

    private func offset(forIndex index: Int, isLifted: Bool) -> CGFloat {
        guard let drag, let target = targetIndex else { return 0 }
        if isLifted { return drag.translation }
        if drag.startIndex < target, index > drag.startIndex, index <= target { return -stride }
        if target < drag.startIndex, index >= target, index < drag.startIndex { return stride }
        return 0
    }

    private func drop() {
        guard let drag, let target = targetIndex else { return }
        var ids = items.map(\.id)
        withAnimation(Self.settle) {
            if target != drag.startIndex {
                ids.insert(ids.remove(at: drag.startIndex), at: target)
                onMove(ids)
            }
            self.drag = nil
        }
    }
}

#Preview("Sıralanabilir liste") {
    struct Sample: Identifiable, Equatable { let id: String }

    struct Host: View {
        @State private var items = ["Epilasyon", "Cilt bakımı", "Masaj", "Saç"].map(Sample.init)

        var body: some View {
            ScrollView {
                KlinaraReorderableList(items: items) { ids in
                    items = ids.compactMap { id in items.first { $0.id == id } }
                } row: { item in
                    KlinaraRow(label: item.id, detail: item.id.lowercased())
                }
                .padding(KlinaraMetrics.screenInset)
            }
            .background(KlinaraColor.surface)
        }
    }

    return Host()
}
