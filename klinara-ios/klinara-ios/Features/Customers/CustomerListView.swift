import SwiftUI

/// "Müşteriler" sekmesinin kökü.
///
/// İki okuma yolu var ve ekran ikisini de gösteriyor ama **karıştırmıyor**:
/// gezinme cursor sayfalamalı `GET /customers`, arama `GET /customers/search`.
/// Aramayı yüklü sayfa üzerinde yerel filtreye bırakmak, kullanıcının hiç
/// görmediği kayıtları aramamak demekti. Hangisinin etkin olduğunu
/// ``CustomerStore/visible`` söylüyor.
struct CustomerListView: View {

    let session: AppSession

    @State private var searchText = ""
    @State private var editing: CustomerEditorView.Target?

    private var store: CustomerStore { session.customerStore }
    private var canWrite: Bool { session.can(Permissions.customerWrite) }
    private var isSearching: Bool { store.searchState != nil }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                listHeader
                tagFilterRow(store.tags)

                KlinaraScreen(
                    state: store.visible,
                    skeleton: .cardsLong,
                    emptyCheck: \.isEmpty,
                    emptyTitle: isSearching || isTagFiltered ? "Eşleşen müşteri yok" : "Müşteri yok",
                    emptyMessage: emptyMessage,
                    emptyIcon: isSearching ? "magnifyingglass" : (isTagFiltered ? "tag" : "person.2"),
                    // Arama ya da etiket sonucu boşken CTA YOK: aranan şey
                    // yaratmak değil, bulmak.
                    emptyActionTitle: canWrite && !isSearching && !isTagFiltered ? "Yeni müşteri" : nil,
                    emptyAction: canWrite && !isSearching && !isTagFiltered
                        ? { editing = .create }
                        : nil,
                    onRetry: {
                        if isSearching {
                            store.retrySearch()
                        } else if isTagFiltered {
                            store.reloadFiltered()
                        } else {
                            await store.reload()
                        }
                    }
                ) { visible in
                    KlinaraCard {
                        ForEach(Array(visible.enumerated()), id: \.element.id) { index, customer in
                            if index > 0 { KlinaraDivider() }
                            KlinaraNavigationRow(
                                label: customer.fullName,
                                detail: detail(for: customer)
                            ) {
                                CustomerDetailView(session: session, customerId: customer.id)
                            }
                            if !customer.tags.isEmpty {
                                CustomerTagRow(tags: customer.tags)
                            }
                        }
                    }

                    if store.canLoadMore {
                        loadMoreTrigger
                    }
                }
                // Aşağı çekerek yenileme YALNIZ listenin işi — dış `VStack`e
                // DEĞİL, buraya bağlı. `.refreshable` eylemi ORTAMA koyuyor ve
                // altındaki her kaydırma görünümü onu üstleniyor; dış yığında
                // dururken etiket şeridi (yatay bir `ScrollView`) de
                // üstleniyordu ve etiketleri yana kaydırmaya çalışmak listeyi
                // yeniden çektiriyordu.
                .refreshable { await store.reload() }
                // Liste alanı SIKIŞTIRILABİLİR ve taşarsa AŞAĞI taşar.
                //
                // İskelet ve boş durum kaydırılmıyor, sabit boyda. Klavye
                // açılınca (özellikle mini/SE boyunda) kalan alana sığmıyor,
                // `VStack` taşmayı iki yana bölüyor ve üstteki arama alanı
                // gezinme çubuğunun altına itiliyordu. `minHeight: 0` yığına
                // "bu alan küçülebilir" diyor; `.top` hizası fazlalığı
                // klavyenin altına bırakıyor. `.clipped()` YOK: liste yüzen
                // sekme çubuğunun arkasına uzanabilmeli.
                .frame(minHeight: 0, maxHeight: .infinity, alignment: .top)
            }
            .background(KlinaraColor.surface)
            .klinaraFAB(isVisible: canWrite, accessibilityLabel: "Yeni müşteri") { editing = .create }
            .navigationTitle("Müşteriler")
            // Görünür başlık ``RootToolbarTitle``; `navigationTitle` geri
            // düğmesi etiketi ve VoiceOver için kalıyor.
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                RootToolbarTitle(title: "Müşteriler")
                ToolbarItem(placement: .topBarTrailing) {
                    // Müşteri kaydı kiracı kapsamlı; şube menüsü burada listeyi
                    // FİLTRELEMEZ. Yine de duruyor: paket satışı, randevu ve
                    // dosya işlemleri müşteri kartından başlıyor ve hepsi seçili
                    // şubeye yazılıyor — hangi şubede olduğunu görmeden bir
                    // paket satmak, yanlış şubeye satmak demekti.
                    BranchMenu(session: session)
                }
            }
            .onChange(of: searchText) { _, term in store.updateSearch(term) }
            .task {
                async let list: Void = store.load()
                async let tags: Void = store.loadTags()
                async let summary: Void = store.loadSummary()
                _ = await (list, tags, summary)
            }
            .sheet(item: $editing) { target in
                CustomerEditorView(session: session, target: target)
            }
        }
        .tint(KlinaraColor.sage)
    }

    private var isTagFiltered: Bool { store.selectedTagId != nil }

    /// Özet şeridi + arama. Arama ya da etiket filtresi etkinken şerit
    /// gizlenir: sayılar tüm tabanı anlatıyor, daraltılmış sonucu değil —
    /// yanında durmaları "bu 12 kişiden 37'si" gibi yanlış okunurdu.
    private var listHeader: some View {
        VStack(spacing: KlinaraMetrics.sm) {
            if !isSearching && !isTagFiltered && searchText.isEmpty {
                CustomerSummaryStrip(summary: store.summary)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
            KlinaraSearchField(text: $searchText, placeholder: "Ad veya telefon")
        }
        .padding(.horizontal, KlinaraMetrics.screenInset)
        .padding(.top, KlinaraMetrics.sm)
        .animation(KlinaraMetrics.stepTransition, value: isSearching || isTagFiltered || !searchText.isEmpty)
    }

    private var emptyMessage: String {
        if isSearching { return "Ad ya da telefon numarasının bir bölümünü yazmayı deneyin." }
        if isTagFiltered { return "Bu etikete sahip müşteri bulunmuyor." }
        return canWrite
            ? "Sağ alttaki artı ile ilk müşteriyi ekleyin."
            : "Henüz müşteri kaydı oluşturulmamış."
    }

    /// Etiket filtresi — "Tümü" + kiracının etiketleri.
    ///
    /// Şerit KOŞULSUZ çizilir, etiket yokken yüksekliği sıfırlanır: `if`in
    /// içinde kalan (yani `Optional`) bir görünüm bu `VStack`in ilk elemanıyken
    /// kimliği her yüklemede değişiyordu. Yükseklik de SABİT verilir — yatay bir
    /// `ScrollView`ün dikey boyu esnektir ve altındaki ``KlinaraScreen`` bütün
    /// yüksekliği istediği için şerit sıfıra eziliyordu.
    private func tagFilterRow(_ tags: [CustomerTag]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: KlinaraMetrics.sm) {
                KlinaraFilterPill(title: "Tümü", isSelected: store.selectedTagId == nil) {
                    store.selectTag(nil)
                }
                ForEach(tags) { tag in
                    KlinaraFilterPill(
                        title: tag.name,
                        isSelected: store.selectedTagId == tag.id,
                        dotColor: CustomerTagChip.color(tag.color)
                    ) {
                        store.selectTag(tag.id)
                    }
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.sm)
        }
        .frame(height: tags.isEmpty ? 0 : Self.tagRowHeight)
        .opacity(tags.isEmpty ? 0 : 1)
        .accessibilityHidden(tags.isEmpty)
    }

    /// Hap yüksekliği (34) + üstten/alttan `sm` dolgu.
    private static let tagRowHeight: CGFloat = 34 + KlinaraMetrics.sm * 2

    private func detail(for customer: Customer) -> String? {
        customer.phone.map(PhoneNumberField.pretty) ?? customer.email
    }

    /// Listenin sonuna gelindiğinde sonraki sayfayı ister. `.onAppear` birden
    /// çok kez tetiklenebilir; ``CustomerStore/loadMore()`` süren isteği kendi
    /// eliyor.
    private var loadMoreTrigger: some View {
        HStack {
            Spacer()
            ProgressView()
                .tint(KlinaraColor.sage)
            Spacer()
        }
        .padding(.vertical, KlinaraMetrics.md)
        .onAppear { Task { await store.loadMore() } }
    }
}

/// Satır altındaki etiket rozetleri.
///
/// ``KlinaraBadge`` sabit bir ton kümesi taşıyor; etiket rengi kullanıcı
/// tarafından seçiliyor, bu yüzden ayrı bir çizim.
struct CustomerTagRow: View {

    let tags: [CustomerTag]

    var body: some View {
        FlowLayout(spacing: KlinaraMetrics.xs) {
            ForEach(tags) { tag in
                CustomerTagChip(tag: tag)
            }
        }
        .padding(.horizontal, KlinaraMetrics.md)
        .padding(.bottom, KlinaraMetrics.sm)
    }
}

struct CustomerTagChip: View {

    let tag: CustomerTag

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(CustomerTagChip.color(tag.color))
                .frame(width: 7, height: 7)
            Text(tag.name)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(KlinaraColor.charcoal)
        }
        .padding(.horizontal, KlinaraMetrics.sm)
        .padding(.vertical, 3)
        .background(KlinaraColor.border.opacity(0.35))
        .clipShape(.capsule)
        .accessibilityLabel("Etiket: \(tag.name)")
    }

    /// `#RRGGBB` → `Color`. Sunucu biçimi doğruluyor ama bozuk bir değer
    /// geldiğinde çizim patlamamalı; nötr bir tona düşer.
    static func color(_ hex: String?) -> Color {
        guard let hex, hex.hasPrefix("#"), hex.count == 7,
              let value = Int(hex.dropFirst(), radix: 16)
        else { return KlinaraColor.charcoalMuted }
        return Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
