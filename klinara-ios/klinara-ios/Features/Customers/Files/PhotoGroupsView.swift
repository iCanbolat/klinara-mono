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

    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.customerMedicalWrite) }

    var body: some View {
        KlinaraScreen(
            state: record.groups,
            onRetry: { await record.loadFiles() }
        ) { groups in
            if groups.isEmpty {
                EmptyStateView(
                    icon: "rectangle.on.rectangle",
                    title: "Grup yok",
                    message: canWrite
                        ? "Öncesi/sonrası karşılaştırması için bir grup oluşturun."
                        : "Henüz karşılaştırma grubu oluşturulmamış."
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
    }

    private func groupCard(_ group: CustomerFileGroup) -> some View {
        KlinaraCard(
            title: group.title,
            footnote: [group.bodyArea, clock.formatDate(group.createdAt)]
                .compactMap { $0 }
                .joined(separator: " · ")
        ) {
            HStack(spacing: KlinaraMetrics.sm) {
                slot(group.file(at: .before), label: "Öncesi")
                slot(group.file(at: .after), label: "Sonrası")
            }
            .padding(KlinaraMetrics.md)
        }
    }

    @ViewBuilder
    private func slot(_ file: CustomerFile?, label: String) -> some View {
        VStack(spacing: KlinaraMetrics.xs) {
            if let file {
                Button { opened = file } label: {
                    PhotoThumbnail(file: file, thumbnails: thumbnails)
                }
                .buttonStyle(.plain)
            } else {
                ZStack {
                    KlinaraColor.border.opacity(0.35)
                    Image(systemName: "plus.viewfinder")
                        .font(.system(size: 18, weight: .light))
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
                .frame(height: 92)
                .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))
            }

            Text(label)
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.charcoalMuted)
        }
        .frame(maxWidth: .infinity)
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
