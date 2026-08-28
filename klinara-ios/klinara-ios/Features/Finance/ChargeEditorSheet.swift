import SwiftUI

/// Elle borç kalemi açma ve düzenleme.
///
/// Yalnız `product` ve `manual` kaynakları elle açılabilir: randevu ve paket
/// kalemleri kendi işlemlerinin transaction'ında **otomatik** doğar ve elle
/// ikincisini yazmak müşteriyi iki kez borçlandırırdı.
///
/// **Fiyat override'ı ayrı bir izne bakar** (`finance.price:override`). İzin
/// yoksa liste fiyatı alanı kilitli kalır; resepsiyonun günlük tahsilat izni
/// yetkisiz indirim anlamına gelemez.
struct ChargeEditorSheet: View {

    let session: AppSession
    let store: CustomerAccountStore
    /// Dolu ise düzenleme, boş ise yeni kalem.
    var editing: Charge?

    @Environment(\.dismiss) private var dismiss

    @State private var source: ChargeSource = .product
    @State private var description = ""
    @State private var quantity = 1
    @State private var unitPriceMinor: Int?
    @State private var listPriceMinor: Int?
    @State private var vatRateBasisPoints = 2000
    @State private var discountId: String?
    @State private var overrideReason = ""
    @State private var error: APIError?
    @State private var idempotencyKey = UUID().uuidString
    @State private var didLoad = false

    private var discountStore: DiscountStore { session.discountStore }
    private var canOverride: Bool { session.can(Permissions.financePriceOverride) }
    private var isEditing: Bool { editing != nil }

    /// Liste fiyatı verilmişse ve birim fiyat ondan farklıysa override var.
    private var isOverriding: Bool {
        guard let unitPriceMinor, let listPriceMinor else { return false }
        return unitPriceMinor != listPriceMinor
    }

    private var needsReason: Bool { isOverriding }

    private var canSubmit: Bool {
        guard !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        guard let unitPriceMinor, unitPriceMinor >= 0 else { return false }
        guard !store.isSaving else { return false }
        if needsReason {
            guard canOverride else { return false }
            guard overrideReason.trimmingCharacters(in: .whitespacesAndNewlines).count >= 5 else {
                return false
            }
        }
        return true
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error, !error.isFieldScoped {
                        ErrorBanner(error: error)
                    }

                    if !isEditing { sourceCard }
                    detailsCard
                    priceCard
                    discountCard
                    if needsReason { overrideCard }
                    totalPreview
                    submitButton
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle(isEditing ? "Kalemi düzenle" : "Kalem ekle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .task {
                await discountStore.load()
                loadOnce()
            }
            .overlay {
                if store.isSaving { AuthLoadingOverlay(message: "Kalem kaydediliyor…") }
            }
        }
        .tint(KlinaraColor.sage)
    }

    // MARK: Bölümler

    private var sourceCard: some View {
        KlinaraCard(title: "Kalem türü", footnote: "Randevu ve paket kalemleri otomatik doğar; buradan açılamaz.") {
            KlinaraSegmentedPicker(
                options: ChargeSource.manuallyCreatable.map(SourceOption.init),
                selection: Binding(
                    get: { SourceOption(source) },
                    set: { source = $0.source }
                ),
                title: { $0.source.turkishName }
            )
            .padding(KlinaraMetrics.md)
        }
    }

    private var detailsCard: some View {
        KlinaraCard(title: "Açıklama") {
            KlinaraTextField(
                label: "Kalem açıklaması",
                text: $description,
                placeholder: "Bakım şampuanı 250 ml",
                error: error?.fieldErrors["description"],
                autocapitalization: .sentences
            )
            .padding(KlinaraMetrics.md)

            KlinaraDivider()
            KlinaraStepperRow(
                label: "Adet",
                value: $quantity,
                range: 1...1000,
                step: 1,
                format: { "\($0)" }
            )
        }
    }

    private var priceCard: some View {
        KlinaraCard(
            title: "Fiyat",
            footnote: "Girilen tutar KDV DAHİLDİR; KDV bu tutarın içinden çıkarılır."
        ) {
            KlinaraMoneyField(
                label: "Birim fiyat (KDV dahil)",
                amountMinor: $unitPriceMinor,
                error: error?.fieldErrors["unitPriceMinor"]
            )
            .padding(KlinaraMetrics.md)

            KlinaraDivider()
            KlinaraMoneyField(
                label: "Liste fiyatı",
                amountMinor: $listPriceMinor,
                footnote: canOverride
                    ? "Boş bırakılırsa birim fiyat liste kabul edilir."
                    : "Liste fiyatının dışına çıkmak için `finance.price:override` izni gerekir."
            )
            .padding(KlinaraMetrics.md)
            .disabled(!canOverride)
            .opacity(canOverride ? 1 : 0.5)

            KlinaraDivider()
            vatPicker
        }
    }

    private var vatPicker: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            Text("KDV oranı")
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.charcoalMuted)

            KlinaraSegmentedPicker(
                options: VatRate.common.map(VatOption.init),
                selection: Binding(
                    get: { VatOption(vatRateBasisPoints) },
                    set: { vatRateBasisPoints = $0.basisPoints }
                ),
                title: { VatRate.format(basisPoints: $0.basisPoints) }
            )
        }
        .padding(KlinaraMetrics.md)
    }

    private var discountCard: some View {
        KlinaraCard(title: "İndirim", footnote: discountFootnote) {
            Button {
                discountId = nil
            } label: {
                KlinaraRow(label: "İndirim yok") {
                    Image(systemName: discountId == nil ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 18))
                        .foregroundStyle(discountId == nil ? KlinaraColor.sageDeep : KlinaraColor.border)
                }
            }
            .buttonStyle(.plain)

            ForEach(discountStore.selectable()) { discount in
                KlinaraDivider()
                Button {
                    discountId = discount.id
                } label: {
                    KlinaraRow(
                        label: discount.name,
                        detail: discount.code.map { "Kod: \($0) · \(discount.valueLabel)" }
                            ?? discount.valueLabel
                    ) {
                        Image(systemName: discountId == discount.id ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 18))
                            .foregroundStyle(
                                discountId == discount.id ? KlinaraColor.sageDeep : KlinaraColor.border
                            )
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var discountFootnote: String {
        discountStore.selectable().isEmpty
            ? "Kullanılabilir indirim yok. Süresi dolmuş ve hakkı tükenmiş indirimler listelenmez."
            : "Süresi dolmuş ve hakkı tükenmiş indirimler listelenmez."
    }

    /// Gerekçe alanı yalnız override gerçekten varken çıkıyor. Her kalem
    /// açılışında "gerekçe" istemek, alanın anlamını boşaltırdı.
    private var overrideCard: some View {
        KlinaraCard(
            title: "Fiyat farkı gerekçesi",
            footnote: "Liste fiyatının dışına çıkıldı; gerekçe denetim kaydına yazılır."
        ) {
            KlinaraTextEditor(
                label: "Gerekçe",
                text: $overrideReason,
                placeholder: "En az 5 karakter",
                error: error?.fieldErrors["priceOverrideReason"],
                minHeight: 80
            )
            .padding(KlinaraMetrics.md)
        }
        .disabled(!canOverride)
    }

    /// Toplamı **yazmadan önce** göstermek gerekiyor: KDV'nin fiyata dahil
    /// olması ekranda karşılığı olmadan anlaşılmıyor.
    private var totalPreview: some View {
        let gross = (unitPriceMinor ?? 0) * quantity
        let discountMinor = previewDiscount(on: gross)
        let total = max(0, gross - discountMinor)
        let vat = MoneyMath.vatIncluded(total: total, rateBasisPoints: vatRateBasisPoints)
        return KlinaraCard(title: "Önizleme") {
            KlinaraRow(label: "Ara toplam", value: Money.format(minor: gross), isMonospaced: true)
            if discountMinor > 0 {
                KlinaraDivider()
                KlinaraRow(
                    label: "İndirim",
                    value: "−\(Money.format(minor: discountMinor))",
                    isMonospaced: true
                )
            }
            KlinaraDivider()
            KlinaraRow(
                label: "Toplam (KDV dahil)",
                value: Money.format(minor: total),
                detail: "İçindeki KDV: \(Money.format(minor: vat)) · Net: \(Money.format(minor: total - vat))",
                isMonospaced: true
            )
        }
    }

    private func previewDiscount(on gross: Int) -> Int {
        guard let discountId, let discount = discountStore.discount(id: discountId) else { return 0 }
        return switch discount.kind {
        case .percent: MoneyMath.percentOf(gross, basisPoints: discount.value)
        case .amount: min(discount.value, gross)
        }
    }

    private var submitButton: some View {
        KlinaraButton(
            title: isEditing ? "Değişikliği kaydet" : "Kalemi ekle",
            kind: .primary,
            icon: isEditing ? "checkmark" : "plus.circle",
            isLoading: store.isSaving,
            isEnabled: canSubmit
        ) {
            Task { await submit() }
        }
    }

    // MARK: Eylem

    /// Düzenleme alanları bir kez dolduruluyor. `.task` her görünümde yeniden
    /// koşabilir ve kullanıcının yazdığını silmek olurdu.
    private func loadOnce() {
        guard !didLoad, let editing else {
            didLoad = true
            return
        }
        didLoad = true
        source = editing.source
        description = editing.description
        quantity = editing.quantity
        unitPriceMinor = editing.unitPriceMinor
        listPriceMinor = editing.unitListPriceMinor
        vatRateBasisPoints = editing.vatRateBasisPoints
        discountId = editing.discountId
        overrideReason = editing.priceOverrideReason ?? ""
    }

    private func submit() async {
        guard let unitPriceMinor else { return }
        error = nil
        let trimmedDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedReason = overrideReason.trimmingCharacters(in: .whitespacesAndNewlines)
        let reason = needsReason && !trimmedReason.isEmpty ? trimmedReason : nil

        do {
            if let editing {
                _ = try await store.updateCharge(
                    id: editing.id,
                    version: editing.version,
                    UpdateChargeInput(
                        description: trimmedDescription,
                        quantity: quantity,
                        unitPriceMinor: unitPriceMinor,
                        // `.clear` ile `.unchanged` farkı burada kritik:
                        // kullanıcı indirimi kaldırdıysa alanı hiç göndermemek
                        // eskisini olduğu gibi bırakırdı.
                        discountId: discountId.map { Nullable.set($0) } ?? .clear,
                        priceOverrideReason: reason
                    )
                )
            } else {
                _ = try await store.createCharge(
                    CreateChargeInput(
                        customerId: store.customerId,
                        source: source.rawValue,
                        description: trimmedDescription,
                        quantity: quantity,
                        unitPriceMinor: unitPriceMinor,
                        unitListPriceMinor: listPriceMinor,
                        discountId: discountId,
                        vatRateBasisPoints: vatRateBasisPoints,
                        priceOverrideReason: reason
                    ),
                    idempotencyKey: idempotencyKey
                )
            }
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}

/// ``KlinaraSegmentedPicker`` `Identifiable` istiyor; ham enum'a uyum eklemek
/// yerine sarmalıyoruz — model dosyası bir arayüz gereksinimini taşımasın.
private struct SourceOption: Hashable, Identifiable {
    let source: ChargeSource
    var id: String { source.rawValue }

    init(_ source: ChargeSource) { self.source = source }
}

private struct VatOption: Hashable, Identifiable {
    let basisPoints: Int
    var id: Int { basisPoints }

    init(_ basisPoints: Int) { self.basisPoints = basisPoints }
}
