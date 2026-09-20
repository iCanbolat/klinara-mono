import SwiftUI

/// Şubeler — "Şube ve Personel" kartından açılır.
///
/// Pasifler dahil tüm şubeler listelenir; pasif olan rozetle ve listenin
/// sonunda. Ekleme ve düzenleme yalnız `branch:write` (owner) ile; diğer
/// roller listeyi okur. Kayıttan sonra oturumun şube listesi de yenilenir:
/// şube menüsü ve şube kapsamlı ekranlar yeni şubeyi hemen görmeli.
struct BranchListView: View {

    let session: AppSession

    @State private var state: LoadState<[BranchDetail]> = .loading
    @State private var editing: BranchDetail?
    @State private var showsCreate = false

    private var canWrite: Bool { session.can(Permissions.branchWrite) }

    var body: some View {
        KlinaraScreen(
            state: state,
            skeleton: .cardsShort,
            emptyCheck: \.isEmpty,
            emptyTitle: "Şube yok",
            // Mesaj artık "+ ile ekleyin" demiyor: aksiyon boş durumun
            // kendisinde duruyor ve yön tarifi gereksizleşti.
            emptyMessage: canWrite ? "İlk şubenizi ekleyerek başlayın." : nil,
            emptyIcon: "building.2",
            emptyActionTitle: canWrite ? "Yeni şube" : nil,
            emptyAction: canWrite ? { showsCreate = true } : nil,
            onRetry: { await load() }
        ) { branches in
            KlinaraCard(
                footnote: canWrite
                    ? "Şube silinmez; pasife alınan şubede yeni randevu açılmaz, geçmiş kayıtlar korunur."
                    : "Şubeleri yalnız işletme sahibi ekleyip düzenleyebilir."
            ) {
                ForEach(Array(sorted(branches).enumerated()), id: \.element.id) { index, branch in
                    if index > 0 { KlinaraDivider() }
                    row(for: branch)
                }
            }
        }
        .navigationTitle("Şubeler")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canWrite {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showsCreate = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Yeni şube")
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showsCreate) {
            BranchFormView(session: session, branch: nil) { _ in
                Task { await saved() }
            }
        }
        .sheet(item: $editing) { branch in
            BranchFormView(session: session, branch: branch) { _ in
                Task { await saved() }
            }
        }
    }

    @ViewBuilder
    private func row(for branch: BranchDetail) -> some View {
        let content = HStack(spacing: KlinaraMetrics.md) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: KlinaraMetrics.xs) {
                    Text(branch.name)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(branch.isActive ? KlinaraColor.charcoal : KlinaraColor.charcoalMuted)
                    if !branch.isActive {
                        KlinaraBadge(text: "Pasif", tone: .muted)
                    }
                    if branch.id == session.selectedBranchId {
                        KlinaraBadge(text: "Seçili", tone: .positive)
                    }
                }
                Text(branch.slug)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                if let address = branch.address {
                    Text(address)
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if canWrite {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }
        }
        .padding(KlinaraMetrics.md)
        .contentShape(.rect)

        if canWrite {
            Button { editing = branch } label: { content }
                .buttonStyle(.plain)
                .accessibilityHint("Düzenlemek için dokunun")
        } else {
            content
        }
    }

    private func sorted(_ branches: [BranchDetail]) -> [BranchDetail] {
        branches.sorted {
            if $0.isActive != $1.isActive { return $0.isActive }
            return $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
    }

    private func load() async {
        do {
            state = .loaded(try await session.services.branches.branches())
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    private func saved() async {
        await load()
        await session.reloadBranches()
    }
}
