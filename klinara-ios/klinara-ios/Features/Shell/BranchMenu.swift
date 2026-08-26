import SwiftUI

/// Toolbar'daki şube göstergesi ve değiştiricisi.
///
/// Şube, uygulamanın her yerinde geçerli bir kapsamdır (`X-Branch-Id`) ama
/// yalnız bir ekranda değiştirilebilseydi kullanıcı "hangi şubedeyim?"
/// sorusunu her ekranda yeniden sorardı. Tek şubeli kliniklerde menü
/// açılmaz — seçenek olmayan bir menü gürültüdür.
struct BranchMenu: View {

    let session: AppSession

    var body: some View {
        if session.canSwitchBranch {
            Menu {
                ForEach(session.branches) { branch in
                    Button {
                        session.switchBranch(to: branch)
                    } label: {
                        if branch.id == session.selectedBranchId {
                            Label(branch.name, systemImage: "checkmark")
                        } else {
                            Text(branch.name)
                        }
                    }
                }
            } label: {
                label(chevron: true)
            }
            .accessibilityLabel("Şube: \(session.selectedBranch?.name ?? "seçilmedi")")
            .accessibilityHint("Şube değiştirmek için dokunun")
        } else {
            label(chevron: false)
                .accessibilityLabel("Şube: \(session.selectedBranch?.name ?? "—")")
        }
    }

    private func label(chevron: Bool) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "building.2")
                .font(.system(size: 12, weight: .medium))
            Text(session.selectedBranch?.name ?? "Şube seçin")
                .klinaraText(.bodyM)
                .lineLimit(1)
            if chevron {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 9, weight: .semibold))
            }
        }
        .foregroundStyle(KlinaraColor.sageDeep)
    }
}
