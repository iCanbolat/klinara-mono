import SwiftUI

/// Randevu kalemini bir paket hakkına bağlar.
///
/// Randevu **henüz tamamlanmadıysa** yalnız bağlar; seans, durum `completed`
/// olduğunda aynı transaction'da düşer. Tamamlanmışsa bağlar VE düşer —
/// sunucu ikisini tek uçta yapıyor, bu ekran farkı kullanıcıya yazıyor.
struct BindPackageSheet: View {

    let session: AppSession
    let appointment: Appointment
    let line: AppointmentServiceLine
    var onBound: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var entitlements: LoadState<[PackageEntitlement]> = .loading
    @State private var selectedItemId: String?
    @State private var error: APIError?
    @State private var isSaving = false
    @State private var idempotencyKey = UUID().uuidString

    private var clock: BranchClock { session.clock }

    var body: some View {
        NavigationStack {
            KlinaraScreen(
                state: entitlements,
                emptyCheck: { $0.isEmpty },
                emptyTitle: "Kullanılabilir hak yok",
                emptyMessage: "Müşterinin bu hizmet için aktif ve süresi dolmamış paketi bulunmuyor.",
                emptyIcon: "shippingbox",
                onRetry: load
            ) { options in
                if let error, !error.isFieldScoped {
                    ErrorBanner(error: error)
                }

                KlinaraCard(title: "Paket hakları", footnote: footnote) {
                    ForEach(Array(options.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { KlinaraDivider() }
                        Button {
                            selectedItemId = item.customerPackageItemId
                        } label: {
                            KlinaraRow(label: item.packageName, detail: detail(item)) {
                                if selectedItemId == item.customerPackageItemId {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(KlinaraColor.sageDeep)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }

                KlinaraButton(
                    title: appointment.status == .completed ? "Bağla ve düş" : "Pakete bağla",
                    kind: .primary,
                    icon: "shippingbox",
                    isLoading: isSaving,
                    isEnabled: selectedItemId != nil && !isSaving
                ) {
                    Task { await bind() }
                }
            }
            .navigationTitle("Pakete bağla")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .task { await load() }
        }
        .tint(KlinaraColor.sage)
    }

    private var footnote: String {
        appointment.status == .completed
            ? "Randevu tamamlandığı için seans HEMEN düşer."
            : "Seans, randevu tamamlandığında düşer."
    }

    private func detail(_ item: PackageEntitlement) -> String {
        var parts = ["\(item.remainingSessions) seans kaldı"]
        if let expiresAt = item.expiresAt {
            parts.append("\(clock.formatDate(expiresAt))'de doluyor")
        }
        return parts.joined(separator: " · ")
    }

    private func load() async {
        entitlements = .loading
        do {
            // Yalnız bu hizmetin hakları: başka bir hizmetin kalemine bağlamak
            // sunucuda zaten reddediliyor, listede göstermek boşuna umut.
            let options = try await session.services.packages.entitlements(
                customerId: appointment.customerId,
                serviceId: line.serviceId,
                branchId: appointment.branchId
            )
            entitlements = .loaded(options)
        } catch {
            entitlements = .failed(error as? APIError ?? .network)
        }
    }

    private func bind() async {
        guard let itemId = selectedItemId else { return }
        error = nil
        isSaving = true
        defer { isSaving = false }
        do {
            _ = try await session.services.packages.consume(
                appointmentId: appointment.id,
                ConsumePackageInput(lines: [
                    ConsumePackageLineInput(
                        appointmentServiceId: line.id,
                        customerPackageItemId: itemId
                    )
                ]),
                idempotencyKey: idempotencyKey
            )
            onBound()
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
