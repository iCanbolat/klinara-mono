import SwiftUI

/// Henüz yazılmamış fazların sekmesi.
///
/// Sahte veri **gösterilmez**: dolu görünen bir takvim, kullanıcının randevu
/// almayı denemesine ve güvenini kaybetmesine yol açar. Boş bir ekran dürüsttür.
struct ComingSoonView: View {

    let title: String
    let icon: String
    let message: String

    var body: some View {
        NavigationStack {
            EmptyStateView(icon: icon, title: title, message: message)
                .background(KlinaraColor.surface)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
        }
        .tint(KlinaraColor.sage)
    }
}

#Preview {
    ComingSoonView(
        title: "Takvim",
        icon: "calendar",
        message: "Randevu takvimi Faz 3 ile geliyor. Şimdilik Yönetim sekmesinden hizmet, personel ve çalışma saatlerini kurabilirsiniz."
    )
}
