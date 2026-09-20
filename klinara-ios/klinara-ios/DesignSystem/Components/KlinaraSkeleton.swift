import SwiftUI

/// Yükleme yer tutucusu — "skeleton".
///
/// Ortadaki dönen çark (`ProgressView`) bir şey **söylemiyordu**: ekranın ne
/// getireceğini, kaç satır geleceğini, gövdenin liste mi form mu olduğunu.
/// Veri geldiği anda boş ekran aniden doluyor, içerik zıplıyordu. Yer tutucu
/// gelecek düzenin ölçüsünü şimdiden çiziyor: yükleme bitince kutular yerini
/// metne bırakıyor, düzen kaymıyor.
///
/// **Hareket nabız, parıltı değil.** Marka kişiliği "calm, authoritative"
/// (`KlinaraMetrics`'teki hareket notu): soldan sağa süzülen bir parıltı
/// ekranın en dikkat çekici öğesi olurdu ve dark mode'da vurgunun tonunu
/// palette olmayan bir renge kaçırırdı. Bunun yerine tüm iskelet grubu tek
/// parça hâlinde yavaşça soluyor. `Reduce Motion` açıkken hiç kıpırdamaz —
/// yer tutucu o zaman da işini görür, çünkü bilgiyi taşıyan şey *düzen*.
///
/// Kullanım ``KlinaraScreen`` üzerinden: `skeleton: .rowsLong`. Ekranlar
/// yer tutucuyu elle kurmaz; kurdukları anda "hangi ekran hangi iskeleti
/// çiziyor" sorusu 23 ayrı dosyaya dağılırdı.

// MARK: - Hareket

/// İskelet grubunun nabzı. Tek bir üst görünüme uygulanır: her çubuğa ayrı
/// animasyon vermek, aynı anda başlamayan onlarca zamanlayıcı demekti.
private struct KlinaraSkeletonPulse: ViewModifier {

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isDimmed = false

    func body(content: Content) -> some View {
        content
            // Animasyon KAPSAMLI biçimde yalnız opaklığa bağlanır.
            //
            // `.animation(_:value:)` biçimi BLANKET'tir: `isDimmed` değiştiği
            // anda alt ağaçtaki her animasyonlu özellik o animasyonu kapar —
            // konum dahil. İskelet ilk kez belirdiğinde konumları daha yeni
            // kuruluyor; blanket biçim bu kuruluşu da animasyona sokuyor ve
            // animasyon `repeatForever(autoreverses:)` olduğu için iskelet
            // sıfır origin (sol üst) ile gerçek çerçevesi arasında SONSUZA
            // KADAR gidip geliyordu. Ekranda görülen şey buydu: kartlar
            // başlığın üstüne binip duruyor, her kare başka bir yerde.
            //
            // `.animation(_:body:)` biçimi animasyonu YALNIZ kapanışın içinde
            // yapılan değişikliğe uygular; geri kalan her şey animasyonsuz
            // yerine oturur.
            .animation(reduceMotion ? nil : Self.pulse) { view in
                view.opacity(isDimmed ? 0.45 : 1)
            }
            .onAppear { if !reduceMotion { isDimmed = true } }
    }

    private static let pulse: Animation =
        .easeInOut(duration: 0.9).repeatForever(autoreverses: true)
}

extension View {

    /// İskelet nabzı. Yalnız yer tutucu ağaçlarında kullanılır.
    func klinaraSkeletonPulse() -> some View {
        modifier(KlinaraSkeletonPulse())
    }
}

// MARK: - İlkeler

/// Bir metin satırının yerini tutan kutu.
///
/// `width == nil` → satır kalan genişliği doldurur. Gerçek metin nadiren tam
/// genişlikte biter; ölçüler çağıranda kasıtlı olarak farklı verilir ki liste
/// bir tablo gibi değil, bir metin bloğu gibi okunsun.
struct KlinaraSkeletonBar: View {

    var width: CGFloat?
    var height: CGFloat = 12
    var cornerRadius: CGFloat = 6

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(KlinaraColor.border.opacity(0.55))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

/// Avatar, ikon ya da renk noktasının yerini tutan daire.
struct KlinaraSkeletonCircle: View {

    var size: CGFloat = 40

    var body: some View {
        Circle()
            .fill(KlinaraColor.border.opacity(0.55))
            .frame(width: size, height: size)
    }
}

/// ``KlinaraCard``'ın yer tutucusu — aynı zemin, aynı kenarlık, aynı yarıçap.
///
/// Kartın *kabuğu* yükleme sırasında da gerçek: kaybolan yalnız içindeki
/// metin. Kabuğu da gri bir kutuya indirgemek, veri gelince kartın kenarlığını
/// birden belirtirdi.
struct KlinaraSkeletonCard<Content: View>: View {

    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(KlinaraColor.surfaceRaised)
        .overlay(
            RoundedRectangle(cornerRadius: KlinaraMetrics.cardRadius)
                .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
        )
        .clipShape(.rect(cornerRadius: KlinaraMetrics.cardRadius))
    }
}

/// ``KlinaraRow`` yer tutucusu: başlık + isteğe bağlı alt satır, sağda değer.
struct KlinaraSkeletonRow: View {

    var hasDetail = true
    var hasValue = false
    /// Satırlar aynı boyda olmasın diye: `0` → 168pt, `1` → 132pt, `2` → 196pt…
    var seed = 0

    private var titleWidth: CGFloat {
        [168, 132, 196, 148, 180, 120][abs(seed) % 6]
    }

    private var detailWidth: CGFloat {
        [104, 136, 88, 120, 96, 128][abs(seed) % 6]
    }

    var body: some View {
        HStack(alignment: .center, spacing: KlinaraMetrics.md) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
                KlinaraSkeletonBar(width: titleWidth, height: 13)
                if hasDetail {
                    KlinaraSkeletonBar(width: detailWidth, height: 11)
                }
            }
            Spacer(minLength: 0)
            if hasValue {
                KlinaraSkeletonBar(width: 56, height: 13)
            }
        }
        .padding(KlinaraMetrics.md)
    }
}

// MARK: - Biçim

/// Hangi düzenin yer tutulacağı.
///
/// Enum değil **struct**: Swift'te enum case'leri varsayılan argüman
/// alamıyor ve her çağıran `.list(rows: 5)` yazmak zorunda kalırdı. Statik
/// üreticiler hem varsayılanı hem okunabilir çağrıyı veriyor.
struct KlinaraSkeletonStyle: Equatable {

    enum Kind: Equatable {
        /// Tek kart, içinde ayraçlı satırlar — ayar ve özet listeleri.
        case rows
        /// Ayrı ayrı kartlar — müşteri, paket, personel listeleri.
        case cards
        /// İki sütunlu özet kartı ızgarası.
        case stats
        /// Özet ızgarası + altında bir grafik kartı — rapor ekranları.
        case report
        /// Yalnız grafik kartı.
        case chart
        /// Başlık bloğu + iki bölüm — detay ekranları.
        case detail
        /// Etiketli alan yığını — form ve editör ekranları.
        case form
        /// Saat sütunlu randevu listesi — takvim ve ajanda.
        case agenda
        /// Hiç yer tutucu yok; eski dönen çark.
        case spinner
    }

    var kind: Kind
    var count: Int = 5
    /// Gövdenin üstünde yatay bir filtre hapı şeridi var mı?
    var hasPills: Bool = false

    /// Gövdenin üstüne yatay bir filtre hapı şeridi ekler.
    func withPills() -> Self {
        var copy = self
        copy.hasPills = true
        return copy
    }

    /// Adet SABİT bir kümeden seçilir, çağıranda serbestçe yazılmaz.
    ///
    /// "Kaç satır?" sorusunun ekran başına ayrı bir cevabı olsaydı, aynı
    /// listenin iki yerdeki yer tutucusu farklı boyda çıkardı; üstelik
    /// çağıranda duran çıplak sayı neyi ölçtüğünü söylemiyordu. Android
    /// `KlinaraSkeletonStyle` ile aynı küme.

    /// Kart içinde üç satır — bölüm boyutunda bir liste.
    static let rowsShort = Self(kind: .rows, count: 3)

    /// Kart içinde beş satır — ekranı dolduran ayar/özet listeleri.
    static let rows = Self(kind: .rows, count: 5)

    /// Kart içinde yedi satır — haftanın günleri gibi sabit uzunluktakiler.
    static let rowsLong = Self(kind: .rows, count: 7)

    /// Üç ayrı kart.
    static let cardsShort = Self(kind: .cards, count: 3)

    /// Dört ayrı kart.
    static let cards = Self(kind: .cards, count: 4)

    /// Altı ayrı kart — uzun kayıt listeleri.
    static let cardsLong = Self(kind: .cards, count: 6)

    /// İki sütunlu özet kartları.
    static let stats = Self(kind: .stats, count: 4)

    /// Özet + grafik.
    static let report = Self(kind: .report, count: 4)

    /// Tek başına grafik kartı — özet şeridi zaten çizilmişken.
    static let chart = Self(kind: .chart, count: 0)

    /// Detay ekranı: başlık bloğu + iki kart.
    static let detail = Self(kind: .detail, count: 3)

    /// Üç alanlı form.
    static let formShort = Self(kind: .form, count: 3)

    /// Dört alanlı form.
    static let form = Self(kind: .form, count: 4)

    /// Beş alanlı form — düzenleyici ekranlar.
    static let formLong = Self(kind: .form, count: 5)

    /// Ajanda / takvim listesi.
    static let agenda = Self(kind: .agenda, count: 5)

    /// Yer tutucu istemeyen ekranlar (tam ekran görsel, medya önizleme).
    static let spinner = Self(kind: .spinner, count: 0)
}

// MARK: - Çizim

/// Bir ``KlinaraSkeletonStyle``i **ekran boşluğu uygulamadan** çizer.
///
/// Zaten bir `ScrollView` + `VStack(padding: screenInset)` içinde duran
/// gövdeler bunu kullanır; ``KlinaraSkeletonView`` ise ekranın tamamını
/// devraldığı için boşluğu kendi uygular. İkisini tek bileşende
/// birleştirmek, çağıranın yarısında çift dolgu demekti.
struct KlinaraSkeletonBody: View {

    let style: KlinaraSkeletonStyle

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
            if style.hasPills { pillRow }
            body(for: style.kind)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .klinaraSkeletonPulse()
        // Tüm iskelet TEK bir erişilebilirlik öğesi: VoiceOver kullanıcısına
        // otuz adet anlamsız gri kutuyu tek tek okutmak, dönen çarktan da
        // kötü olurdu.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Yükleniyor")
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private func body(for kind: KlinaraSkeletonStyle.Kind) -> some View {
        switch kind {
        case .rows:
            KlinaraSkeletonCard {
                ForEach(0..<max(1, style.count), id: \.self) { index in
                    if index > 0 { KlinaraDivider() }
                    KlinaraSkeletonRow(hasValue: true, seed: index)
                }
            }

        case .cards:
            ForEach(0..<max(1, style.count), id: \.self) { index in
                KlinaraSkeletonCard {
                    KlinaraSkeletonRow(seed: index)
                }
            }

        case .stats:
            statGrid(count: style.count)

        case .report:
            statGrid(count: style.count)
            chartCard

        case .chart:
            chartCard

        case .detail:
            VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
                KlinaraSkeletonBar(width: 208, height: 20)
                KlinaraSkeletonBar(width: 132, height: 13)
            }
            KlinaraSkeletonCard {
                ForEach(0..<3, id: \.self) { index in
                    if index > 0 { KlinaraDivider() }
                    KlinaraSkeletonRow(hasDetail: false, hasValue: true, seed: index)
                }
            }
            KlinaraSkeletonCard {
                ForEach(0..<2, id: \.self) { index in
                    if index > 0 { KlinaraDivider() }
                    KlinaraSkeletonRow(seed: index + 3)
                }
            }

        case .form:
            ForEach(0..<max(1, style.count), id: \.self) { index in
                VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
                    KlinaraSkeletonBar(width: [88, 112, 72, 96][index % 4], height: 11)
                    RoundedRectangle(cornerRadius: KlinaraMetrics.controlRadius, style: .continuous)
                        .fill(KlinaraColor.surfaceRaised)
                        .overlay(
                            RoundedRectangle(cornerRadius: KlinaraMetrics.controlRadius)
                                .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
                        )
                        .frame(height: KlinaraMetrics.fieldHeight)
                }
            }

        case .agenda:
            ForEach(0..<max(1, style.count), id: \.self) { index in
                HStack(alignment: .top, spacing: KlinaraMetrics.md) {
                    // Saat sütunu: ajandanın sol kenarı sabit genişlikte ve
                    // veri gelince kaymamalı.
                    KlinaraSkeletonBar(width: 44, height: 13)
                        .padding(.top, KlinaraMetrics.md)
                    KlinaraSkeletonCard {
                        KlinaraSkeletonRow(hasValue: true, seed: index)
                    }
                }
            }

        case .spinner:
            EmptyView()
        }
    }

    /// Yatay filtre hapı şeridi — müşterilerde etiket, takvimde personel.
    private var pillRow: some View {
        HStack(spacing: KlinaraMetrics.sm) {
            ForEach(0..<4, id: \.self) { index in
                Capsule()
                    .fill(KlinaraColor.border.opacity(0.55))
                    .frame(width: [56, 88, 72, 96][index], height: 34)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipped()
    }

    /// ``KlinaraStatStrip`` ile aynı ızgara: iki sütun, eşit boy.
    private func statGrid(count: Int) -> some View {
        Grid(alignment: .topLeading, horizontalSpacing: KlinaraMetrics.sm, verticalSpacing: KlinaraMetrics.sm) {
            ForEach(Array(stride(from: 0, to: max(2, count), by: 2)), id: \.self) { start in
                GridRow {
                    statCard(seed: start)
                    if start + 1 < max(2, count) {
                        statCard(seed: start + 1)
                    } else {
                        Color.clear
                    }
                }
            }
        }
    }

    private func statCard(seed: Int) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            KlinaraSkeletonBar(width: [96, 76, 108, 88][seed % 4], height: 10)
            KlinaraSkeletonBar(width: [72, 96, 60, 84][seed % 4], height: 20)
            KlinaraSkeletonBar(width: [120, 88, 104, 132][seed % 4], height: 10)
        }
        .padding(KlinaraMetrics.md)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(KlinaraColor.surfaceRaised)
        .overlay(
            RoundedRectangle(cornerRadius: KlinaraMetrics.cardRadius)
                .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
        )
        .clipShape(.rect(cornerRadius: KlinaraMetrics.cardRadius))
    }

    /// Grafik kartı: eksen çizgisi üzerinde değişen boyda sütunlar.
    private var chartCard: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
            KlinaraSkeletonBar(width: 132, height: 12)
            HStack(alignment: .bottom, spacing: KlinaraMetrics.sm) {
                ForEach(0..<7, id: \.self) { index in
                    RoundedRectangle(cornerRadius: KlinaraMetrics.xs, style: .continuous)
                        .fill(KlinaraColor.border.opacity(0.55))
                        .frame(maxWidth: .infinity)
                        .frame(height: [56, 92, 40, 120, 72, 104, 48][index])
                }
            }
            .frame(height: 120, alignment: .bottom)
            KlinaraSkeletonBar(height: 1, cornerRadius: 0)
        }
        .padding(KlinaraMetrics.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(KlinaraColor.surfaceRaised)
        .overlay(
            RoundedRectangle(cornerRadius: KlinaraMetrics.cardRadius)
                .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
        )
        .clipShape(.rect(cornerRadius: KlinaraMetrics.cardRadius))
    }
}

/// Ekranın tamamını kaplayan yer tutucu — ``KlinaraScreen``'in yükleme dalı.
///
/// Ekran boşluklarıyla birebir aynı ölçüleri kullanır (`screenInset`, `lg`):
/// yer tutucu ile gerçek içerik farklı bir ızgarada otursaydı, veri gelince
/// her şey bir kez kayardı — yer tutucunun var olma sebebi tam olarak bu
/// kaymayı önlemek.
struct KlinaraSkeletonView: View {

    let style: KlinaraSkeletonStyle

    var body: some View {
        if style.kind == .spinner {
            ProgressView()
                .progressViewStyle(.circular)
                .tint(KlinaraColor.sage)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            KlinaraSkeletonBody(style: style)
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }
}

/// Çip ızgarası yer tutucusu — randevu akışındaki saat seçimi.
///
/// Kaç saatin geleceği bilinmiyor ama *ızgara olduğu* biliniyor: dönen çark
/// bunu söylemiyor ve saatler gelince alan bir anda üç satır büyüyordu.
struct KlinaraSkeletonChips: View {

    var count: Int = 10

    var body: some View {
        FlowLayout(spacing: KlinaraMetrics.sm) {
            ForEach(0..<max(1, count), id: \.self) { _ in
                RoundedRectangle(cornerRadius: KlinaraMetrics.controlRadius, style: .continuous)
                    .fill(KlinaraColor.border.opacity(0.55))
                    .frame(width: 74, height: 40)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .klinaraSkeletonPulse()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Yükleniyor")
        .allowsHitTesting(false)
    }
}

/// Bölüm içi (kart içindeki) yer tutucu.
///
/// ``KlinaraSkeletonView`` bir ekranın tamamını üstleniyor ve kendi ekran
/// boşluklarını uyguluyor; müşteri detayındaki "Notlar", "Paketler",
/// "Zaman çizelgesi" gibi bölümler ise ZATEN bir kartın içinde ve kendi
/// başlıklarını çizmiş oluyor. O bölümlerin ihtiyacı yalnız birkaç satır.
struct KlinaraSkeletonSection: View {

    var rows: Int = 3
    var hasDetail: Bool = true

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<max(1, rows), id: \.self) { index in
                if index > 0 { KlinaraDivider() }
                KlinaraSkeletonRow(hasDetail: hasDetail, seed: index)
            }
        }
        .klinaraSkeletonPulse()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Yükleniyor")
        .allowsHitTesting(false)
    }
}

#Preview("Kart listesi") {
    KlinaraSkeletonView(style: .cards.withPills())
        .background(KlinaraColor.surface)
}

#Preview("Rapor") {
    KlinaraSkeletonView(style: .report)
        .background(KlinaraColor.surface)
}

#Preview("Form") {
    KlinaraSkeletonView(style: .form)
        .background(KlinaraColor.surface)
}
