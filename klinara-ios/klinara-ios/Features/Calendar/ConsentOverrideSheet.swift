import SwiftUI

/// İşlem onamı eksikken işleme geçiş: yumuşak uyarı.
///
/// Sunucu `409 CONSENT_MISSING` döndüğünde açılır. Hata değil karar noktası:
/// personel önce imza aldırmalı, ama kağıt formu imzalatmış olabilir; bu
/// yüzden gerekçeyle devam etmek mümkün. Gerekçe BOŞ olamaz ve sunucuda randevu
/// geçmişine düşer. Aynı istek gerekçeyle tekrarlanır — sunucu gerekçe bir kez
/// yazıldıysa `completed` geçişinde yeniden sormaz.
struct ConsentOverrideRequest: Identifiable, Equatable {
    let status: AppointmentStatus
    let titles: [String]

    var id: String { status.rawValue }
}

struct ConsentOverrideSheet: View {

    /// Sunucudaki `CONSENT_LIMITS.overrideReason`.
    private static let maxLength = 500

    let session: AppSession
    let appointment: Appointment
    let request: ConsentOverrideRequest
    let onChanged: (Appointment) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var error: APIError?

    private var trimmed: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var missingText: String {
        request.titles.isEmpty ? "işlem onamı" : request.titles.joined(separator: ", ")
    }

    var body: some View {
        KlinaraFormScaffold(
            title: "Onam eksik",
            saveTitle: "Devam et",
            canSave: !trimmed.isEmpty,
            isDirty: !trimmed.isEmpty,
            isSaving: session.calendarStore.isSaving,
            error: error,
            invalidSaveMessage: "Devam etmek için gerekçe yazın.",
            onSave: confirm
        ) {
            KlinaraFormSection(
                title: "Eksik onam",
                footnote: "Önce hastaya imzalatmanız önerilir. Yine de devam edecekseniz "
                    + "gerekçeyi yazın; gerekçe randevu geçmişine kaydedilir."
            ) {
                KlinaraRow(
                    label: missingText,
                    detail: "\(request.status.turkishName) durumuna geçmeden önce imzalanmamış."
                ) {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundStyle(KlinaraColor.danger)
                }
            }

            KlinaraFormSection {
                KlinaraTextEditor(
                    label: "Gerekçe",
                    text: $reason,
                    placeholder: "Örn. hasta kağıt formu imzaladı, sonra taranacak",
                    minHeight: 96
                )
                .padding(KlinaraMetrics.md)
                .onChange(of: reason) { _, value in
                    if value.count > Self.maxLength { reason = String(value.prefix(Self.maxLength)) }
                }
            }
        }
    }

    private func confirm() async {
        error = nil
        do {
            let updated = try await session.calendarStore.changeStatus(
                appointment,
                to: request.status,
                consentOverrideReason: trimmed
            )
            onChanged(updated)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
