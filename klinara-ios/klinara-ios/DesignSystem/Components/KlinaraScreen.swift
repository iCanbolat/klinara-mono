import SwiftUI

/// Bir ekranın veri durumu.
///
/// Yükleniyor / hata / boş / dolu ayrımını her ekranın `if isLoading … else if
/// error … else if isEmpty` zinciriyle kurması, dördünden birinin bir ekranda
/// unutulmasıyla biter (genelde boş durum).
enum LoadState<Value: Sendable>: Sendable {
    case loading
    case loaded(Value)
    case failed(APIError)

    var value: Value? {
        if case .loaded(let value) = self { return value }
        return nil
    }

    var error: APIError? {
        if case .failed(let error) = self { return error }
        return nil
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}

/// Oturum içi ekranların ortak iskeleti — ``AuthScaffold``'un karşılığı.
///
/// `AuthScaffold` giriş akışına özeldir (alt aksiyon alanı, geri oku, logo);
/// oturum açıldıktan sonraki ekranlar liste/form ekranlarıdır ve farklı bir
/// iskelet ister: kaydırılabilir gövde, üstte hata bandı, yükleme ve boş durum.
struct KlinaraScreen<Value: Sendable, Content: View>: View {

    let state: LoadState<Value>
    /// Yükleme sırasında çizilecek yer tutucu düzeni.
    ///
    /// Varsayılan kart listesi: bu iskeletten geçen ekranların çoğunluğu bir
    /// liste. Gövdesi form, rapor ya da detay olan ekranlar kendi biçimini
    /// verir — yanlış biçim, dönen çarktan daha kötüdür: kullanıcıya olmayan
    /// bir düzen vaat eder ve veri gelince her şey kayar.
    var skeleton: KlinaraSkeletonStyle = .cards
    /// Elde veri VARKEN süren yeniden çekme.
    ///
    /// Yer tutucuya geri dönmek yerine içerik yerinde kalır ve soluklaşır:
    /// filtre değiştirmek ya da gün atlamak *aynı* düzeni yeniden doldurur,
    /// başka bir ekran açmaz. İskeleti geri çağırmak o düzeni bir anlığına
    /// söküp yeniden kurmak demekti — ekran zıplar, kaydırma konumu sıfırlanır
    /// ve iskelet yanıttan hızlı olduğu için hepsi tek bir yanıp sönme olarak
    /// görünür. Soluklaşma aynı bilgiyi düzen kaymadan veriyor.
    var isRefreshing = false
    var emptyCheck: ((Value) -> Bool)?
    var emptyTitle = "Kayıt yok"
    var emptyMessage: String?
    var emptyIcon = "tray"
    /// Boş durumdaki birincil aksiyon — "Yeni paket", "Yeni istisna"…
    ///
    /// Bu iki alan olmadan ``EmptyStateView``in CTA'sı bu iskeletten geçen
    /// ekranlar için ERİŞİLEMEZDİ: liste ekranlarının çoğu buradan geçiyor ve
    /// yaratma yolu yalnız üst çubuktaki ikonda kalınca, ekranı ilk kez açan
    /// kişi nereye basacağını bulamıyordu.
    var emptyActionTitle: String?
    var emptyActionIcon: String? = "plus"
    var emptyAction: (() -> Void)?
    var onRetry: (() async -> Void)?
    @ViewBuilder var content: (Value) -> Content

    var body: some View {
        ZStack {
            KlinaraColor.surface.ignoresSafeArea()

            // Dallar arası geçiş SOLMA, kayma değil: blanket bir
            // `.animation(value:)` altında yeni beliren dal hedef çerçevesine
            // kabın sıfır origin'inden doğru kayabilir. Açık geçiş, beliren
            // dalı yerinde tutup yalnız opaklığını oynatır.
            stateContent
                .transition(.opacity)
        }
        .animation(KlinaraMetrics.feedback, value: state.isLoading)
    }

    /// Süren yeniden çekmenin görünür karşılığı. Yalnız DOLU durumda anlamlı:
    /// iskelet ve hata zaten kendi başlarına "şu an veri yok" diyor.
    private var refreshDim: Double {
        isRefreshing && state.value != nil ? 0.45 : 1
    }

    @ViewBuilder
    private var stateContent: some View {
        switch state {
        case .loading:
            KlinaraSkeletonView(style: skeleton)

        case .failed(let error) where error.isSilent:
            // İptal edilmiş istek bir hata DEĞİL ve mesajı boş: banda
            // düşseydi ekranda metinsiz kırmızı bir kutu kalırdı. Yerine
            // geçen istek sürüyor; doğru karşılık yükleniyor görünmek.
            KlinaraSkeletonView(style: skeleton)

        case .failed(let error):
            VStack(spacing: KlinaraMetrics.md) {
                ErrorBanner(error: error, onRetry: onRetry.map { retry in
                    { Task { await retry() } }
                })
                Spacer(minLength: 0)
            }
            .padding(KlinaraMetrics.screenInset)

        case .loaded(let value):
            if emptyCheck?(value) == true {
                EmptyStateView(
                    icon: emptyIcon,
                    title: emptyTitle,
                    message: emptyMessage,
                    actionTitle: emptyActionTitle,
                    actionIcon: emptyActionIcon,
                    action: emptyAction
                )
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                        content(value)
                    }
                    .padding(.horizontal, KlinaraMetrics.screenInset)
                    .padding(.vertical, KlinaraMetrics.lg)
                    // Animasyon KAPSAMLI biçimde yalnız opaklığa bağlı.
                    //
                    // `.animation(_:value:)` blanket'tir ve alt ağaçtaki her
                    // animasyonlu özelliği — konum dahil — yakalar; yeniden
                    // çekme başladığında bütün listeyi kaydırırdı.
                    // `.animation(_:body:)` yalnız kapanışın içindekini
                    // animasyona sokar (aynı tuzak ``KlinaraSkeletonPulse``
                    // içinde de vardı).
                    .animation(KlinaraMetrics.feedback) { view in
                        view.opacity(refreshDim)
                    }
                    // Soluk içerik BAYAT içeriktir: gelmek üzere olan yanıt
                    // onu değiştirecek ve bu aralıkta dokunmak, kullanıcının
                    // artık görmediği bir kaydı açardı. Kaydırma AÇIK kalır —
                    // `.disabled` onu da keserdi ve aşağı çekerek yenilerken
                    // jest kendi kendini iptal ederdi.
                    .allowsHitTesting(refreshDim == 1)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
    }
}

/// Boş durum — Faz 3/4 sekmelerinde ve filtrelenmiş listelerde.
///
/// Boş durum bir hata DEĞİLDİR ve öyle görünmez: ikon yumuşak bir adaçayı
/// dairenin içinde durur, `danger` yoktur. Metin ne olduğunu değil **ne
/// yapılacağını** söyler; "Liste boş" kullanıcıya hiçbir şey öğretmez.
///
/// [actionTitle] verilirse birincil aksiyon burada da çizilir: yaratma yolu
/// yalnız üst çubuktaki ikonda kalırsa, ekranı ilk kez açan kişi nereye
/// basacağını bulamaz.
struct EmptyStateView: View {

    var icon = "tray"
    let title: String
    var message: String?
    var actionTitle: String?
    var actionIcon: String? = "plus"
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: KlinaraMetrics.md) {
            Image(systemName: icon)
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(KlinaraColor.sageDeep)
                .frame(width: 72, height: 72)
                .background(KlinaraColor.sageSoft)
                .clipShape(.circle)
                .accessibilityHidden(true)

            Text(title)
                .klinaraText(.titleM)
                .foregroundStyle(KlinaraColor.charcoal)
                .multilineTextAlignment(.center)

            if let message {
                Text(message)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let actionTitle, let action {
                KlinaraButton(title: actionTitle, kind: .secondary, icon: actionIcon, action: action)
                    .padding(.top, KlinaraMetrics.sm)
                    .frame(maxWidth: 260)
            }
        }
        .padding(KlinaraMetrics.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview("Boş durum") {
    EmptyStateView(
        icon: "calendar",
        title: "Takvim yakında",
        message: "Randevu ekranları Faz 3 ile gelecek.",
        actionTitle: "Yönetime git",
        action: {}
    )
    .background(KlinaraColor.surface)
}
