import SwiftUI

/// Öncesi/sonrası grupları.
///
/// Grup, aynı bölgenin iki fotoğrafını **yan yana** gösterebilmek için var:
/// tek bir ızgarada "öncesi" ve "sonrası" birbirinden onlarca kaydırma uzakta
/// kalır ve karşılaştırma diye bir şey olmaz.
struct PhotoGroupsView: View {

    let session: AppSession
    let record: CustomerRecordStore
    let thumbnails: ThumbnailCache

    @State private var creating = false
    @State private var opened: CustomerFile?
    @State private var filling: SlotTarget?

    /// Doldurulmak istenen yuva. Grup ve konum birlikte taşınıyor: yükleme
    /// sayfası ikisini de önseçili açıyor.
    private struct SlotTarget: Identifiable {
        let groupId: String
        let position: FilePosition

        var id: String { "\(groupId)-\(position.rawValue)" }
    }

    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.customerMedicalWrite) }

    var body: some View {
        KlinaraScreen(
            state: record.groups,
            skeleton: .cardsShort,
            onRetry: { await record.loadFiles() }
        ) { groups in
            if groups.isEmpty {
                EmptyStateView(
                    icon: "rectangle.on.rectangle",
                    title: "Grup yok",
                    message: canWrite
                        ? "Öncesi/sonrası karşılaştırması için bir grup oluşturun."
                        : "Henüz karşılaştırma grubu oluşturulmamış.",
                    actionTitle: canWrite ? "Yeni grup" : nil,
                    action: canWrite ? { creating = true } : nil
                )
            } else {
                ForEach(groups) { group in
                    groupCard(group)
                }
            }
        }
        .navigationTitle("Öncesi / sonrası")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canWrite {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { creating = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Yeni grup")
                }
            }
        }
        .task { await record.loadFiles() }
        .sheet(isPresented: $creating) {
            FileGroupEditorView(session: session, record: record)
        }
        .sheet(item: $opened) { file in
            PhotoDetailView(
                session: session,
                record: record,
                thumbnails: thumbnails,
                file: file
            )
        }
        .sheet(item: $filling) { target in
            FileUploadSheet(
                session: session,
                record: record,
                kind: .photo,
                presetGroupId: target.groupId,
                presetPosition: target.position
            )
        }
    }

    private func groupCard(_ group: CustomerFileGroup) -> some View {
        KlinaraCard(
            title: group.title,
            footnote: [group.bodyArea, clock.formatDate(group.createdAt)]
                .compactMap { $0 }
                .joined(separator: " · ")
        ) {
            HStack(spacing: KlinaraMetrics.sm) {
                slot(group.file(at: .before), in: group, at: .before)
                slot(group.file(at: .after), in: group, at: .after)
            }
            .padding(KlinaraMetrics.md)
        }
    }

    /// Boş yuva **dokunulabilir**: ikonu artı işareti taşıdığı hâlde eylemsizdi
    /// ve fotoğrafı gruba koymanın tek yolu ekrandan çıkıp müşteri kartındaki
    /// genel yükleme sayfasında grubu ve konumu elle seçmekti.
    ///
    /// Yazma izni yoksa yuva eskisi gibi pasif kalıyor — dokunup yetki hatası
    /// almak, en baştan dokunamamaktan kötü.
    @ViewBuilder
    private func slot(
        _ file: CustomerFile?,
        in group: CustomerFileGroup,
        at position: FilePosition
    ) -> some View {
        VStack(spacing: KlinaraMetrics.xs) {
            if let file {
                Button { opened = file } label: {
                    PhotoThumbnail(file: file, thumbnails: thumbnails)
                }
                .buttonStyle(.plain)
            } else if canWrite {
                Button {
                    filling = SlotTarget(groupId: group.id, position: position)
                } label: {
                    emptySlot
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(position.turkishName) fotoğrafı ekle")
            } else {
                emptySlot
            }

            Text(position.turkishName)
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.charcoalMuted)
        }
        .frame(maxWidth: .infinity)
    }

    private var emptySlot: some View {
        ZStack {
            KlinaraColor.border.opacity(0.35)
            Image(systemName: "plus.viewfinder")
                .font(.system(size: 18, weight: .light))
                .foregroundStyle(KlinaraColor.charcoalMuted)
        }
        .frame(height: 92)
        .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))
        .contentShape(.rect)
    }
}

/// Grup oluşturma sayfası.
struct FileGroupEditorView: View {

    let session: AppSession
    let record: CustomerRecordStore

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var bodyArea = ""
    @State private var serviceId: String?
    @State private var error: APIError?

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        KlinaraFormScaffold(
            title: "Yeni grup",
            canSave: !trimmedTitle.isEmpty,
            isDirty: !trimmedTitle.isEmpty,
            isReadOnly: false,
            isSaving: record.isSaving,
            error: error,
            onSave: save
        ) {
            KlinaraFormSection(
                title: "Grup",
                footnote: "Fotoğraflar yüklenirken bu gruba bağlanır."
            ) {
                KlinaraTextField(
                    label: "Başlık",
                    text: $title,
                    placeholder: "Sağ kol — 3. seans",
                    error: error?.fieldErrors["title"],
                    autocapitalization: .sentences
                )
                .padding(KlinaraMetrics.md)

                KlinaraDivider()

                KlinaraTextField(
                    label: "Vücut bölgesi",
                    text: $bodyArea,
                    placeholder: "sağ kol",
                    error: error?.fieldErrors["bodyArea"]
                )
                .padding(KlinaraMetrics.md)

                KlinaraDivider()

                Picker("Hizmet", selection: $serviceId) {
                    Text("Bağlı değil").tag(String?.none)
                    ForEach(session.catalogStore.state.value?.services ?? []) { service in
                        Text(service.name).tag(String?.some(service.id))
                    }
                }
                .pickerStyle(.menu)
                .tint(KlinaraColor.sageDeep)
                .klinaraText(.bodyM)
                .padding(KlinaraMetrics.md)
            }
        }
        .task { await session.catalogStore.load() }
    }

    private func save() async {
        error = nil
        do {
            _ = try await record.createGroup(CreateFileGroupInput(
                title: trimmedTitle,
                bodyArea: bodyArea.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? nil
                    : bodyArea.trimmingCharacters(in: .whitespacesAndNewlines),
                serviceId: serviceId
            ))
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
