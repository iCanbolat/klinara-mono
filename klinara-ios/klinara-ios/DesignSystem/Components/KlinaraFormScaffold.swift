import SwiftUI

/// Düzenleme formlarının ortak iskeleti (sheet içinde kullanılır).
///
/// Dört şeyi tek yerde çözer:
/// 1. İptal / Kaydet toolbar'ı ve kaydederken kilitlenme,
/// 2. kirli formda "vazgeç" onayı — yanlışlıkla kapatılan form veri kaybıdır,
/// 3. alan bazlı olmayan hataların üstte gösterilmesi,
/// 4. salt okunur mod (yetkisi olmayan kullanıcı formu görebilir ama kaydedemez).
struct KlinaraFormScaffold<Content: View>: View {

    let title: String
    var saveTitle = "Kaydet"
    /// `false` ise Kaydet pasif — zorunlu alanlar eksik.
    var canSave = true
    var isDirty = false
    var isReadOnly = false
    var isSaving = false
    var error: APIError?
    let onSave: () async -> Void
    @ViewBuilder var content: () -> Content

    @Environment(\.dismiss) private var dismiss
    @State private var showsDiscardConfirmation = false

    var body: some View {
        NavigationStack {
            ZStack {
                KlinaraColor.surface.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                        // Alan bazlı hatalar zaten alanların altında; burada
                        // tekrar etmek aynı şeyi iki kez söylemek olurdu.
                        if let error, !error.isFieldScoped {
                            ErrorBanner(error: error)
                        }
                        content()
                    }
                    .padding(.horizontal, KlinaraMetrics.screenInset)
                    .padding(.vertical, KlinaraMetrics.lg)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(isReadOnly ? "Kapat" : "Vazgeç") {
                        if isDirty && !isReadOnly {
                            showsDiscardConfirmation = true
                        } else {
                            dismiss()
                        }
                    }
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .disabled(isSaving)
                }

                if !isReadOnly {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(saveTitle) {
                            Task { await onSave() }
                        }
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(
                            canSave && !isSaving ? KlinaraColor.sageDeep : KlinaraColor.charcoalMuted
                        )
                        .disabled(!canSave || isSaving)
                    }
                }
            }
            .interactiveDismissDisabled(isDirty && !isReadOnly)
            .confirmationDialog(
                "Değişiklikler kaydedilmedi",
                isPresented: $showsDiscardConfirmation,
                titleVisibility: .visible
            ) {
                Button("Değişiklikleri sil", role: .destructive) { dismiss() }
                Button("Düzenlemeye dön", role: .cancel) {}
            }
            .overlay {
                if isSaving {
                    AuthLoadingOverlay(message: "Kaydediliyor…")
                }
            }
        }
        .tint(KlinaraColor.sage)
    }
}

/// Formdaki bir bölüm — başlık + kart.
struct KlinaraFormSection<Content: View>: View {

    var title: String?
    var footnote: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        KlinaraCard(title: title, footnote: footnote, content: content)
    }
}
