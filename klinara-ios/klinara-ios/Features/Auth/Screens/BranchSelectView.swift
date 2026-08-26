import SwiftUI

/// Şube seçimi. Seçilen şube `X-Branch-Id` başlığı olarak taşınır.
///
/// `GET /me` yalnız `branchIds` döndürür — adlar `GET /branches`'ten gelir
/// ve kiracı kapsamlı olmayan kullanıcı için üyeliğine göre filtrelenir.
struct BranchSelectView: View {

    @Bindable var model: AuthFlowModel

    var body: some View {
        AuthScaffold(
            eyebrow: "Şube",
            title: "Bugün hangi şubedesiniz?",
            subtitle: "Takviminiz ve müşteri kayıtlarınız seçtiğiniz şubeye göre görünür."
        ) {
            VStack(spacing: KlinaraMetrics.sm) {
                if let error = model.error {
                    ErrorBanner(error: error)
                }

                ForEach(model.branches) { branch in
                    SelectionRow(
                        title: branch.name,
                        subtitle: branch.address,
                        isBusy: model.isBusy
                    ) {
                        Task { await model.selectBranch(branch) }
                    }
                }
            }
        } actions: {
            Text("Şubeyi daha sonra uygulama içinden değiştirebilirsiniz.")
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.bottom, KlinaraMetrics.sm)
        }
    }
}

#Preview {
    let model = AuthFlowModel(services: .mock(scenario: .multiBranch))
    return BranchSelectView(model: model)
}
