import SwiftUI

/// Açılış ekranı. Keychain'deki oturum geri yüklenirken görünür.
///
/// Marka işareti ortada, hareket yok: ilk izlenim sakin olmalı.
struct LaunchView: View {

    var body: some View {
        VStack(spacing: KlinaraMetrics.xl) {
            Spacer()

            KlinaraWordmark(markSize: 88)

            Spacer()

            ProgressView()
                .progressViewStyle(.circular)
                .tint(KlinaraColor.sage)
                .padding(.bottom, KlinaraMetrics.xxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KlinaraColor.surface)
    }
}

#Preview {
    LaunchView()
}
