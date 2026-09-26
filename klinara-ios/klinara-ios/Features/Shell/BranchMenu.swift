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
                ForEach(session.switchableBranches) { branch in
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

/// Sekme köklerinin sol üst başlığı.
///
/// Sistem başlığı yerine baş kenarda kendi metnimiz: `.inline` başlık ortaya
/// oturuyordu. Boyut ve kalınlık Android üst çubuğuyla aynı
/// (``KlinaraFont/toolbarTitle``). iOS 26'nın toolbar kapsülü kapatılıyor:
/// başlık bir düğme değil.
struct RootToolbarTitle: ToolbarContent {

    let title: String

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Text(title)
                .font(KlinaraFont.toolbarTitle)
                .foregroundStyle(KlinaraColor.charcoal)
                .lineLimit(1)
                .fixedSize()
                .accessibilityAddTraits(.isHeader)
        }
        .sharedBackgroundVisibility(.hidden)

        // Boş `.principal`: `.inline` sistem başlığı ortada ikinci kez
        // çizilmesin. `navigationTitle` geri düğmesi/VoiceOver için yerinde.
        ToolbarItem(placement: .principal) {
            Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
        }
    }
}
