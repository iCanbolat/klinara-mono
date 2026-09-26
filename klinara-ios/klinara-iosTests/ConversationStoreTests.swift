import Foundation
import Testing
@testable import klinara_ios

/// Sohbet store'larının davranış testleri — mock, sunucunun kurallarını taklit ediyor.
@MainActor
@Suite("Sohbet store'ları")
struct ConversationStoreTests {

    private func service() -> MockConversationsService {
        MockConversationsService(latencyEnabled: false)
    }

    // MARK: Liste

    @Test("Süzgeçler: açık, okunmamış, kapalı")
    func filtersList() async {
        let store = ConversationListStore(service: service())
        await store.load()
        #expect(store.conversations.map(\.id) == [
            MockConversationsService.openId,
            MockConversationsService.closedWindowId,
        ])

        await store.applyFilter(.unread)
        #expect(store.conversations.map(\.id) == [MockConversationsService.openId])

        await store.applyFilter(.closed)
        #expect(store.conversations.map(\.id) == [MockConversationsService.archivedId])
    }

    @Test("Akıştaki kapatma listeye yansır; süzgece uymayan satır düşer")
    func listReflectsThreadChanges() async {
        let mock = service()
        let list = ConversationListStore(service: mock)
        await list.load()

        let thread = ConversationThreadStore(service: mock, conversationId: MockConversationsService.openId)
        thread.onChange = { list.update($0) }
        await thread.load()
        #expect(list.conversations.first { $0.id == MockConversationsService.openId }?.unread == false)

        await thread.setClosed(true)
        #expect(!list.conversations.contains { $0.id == MockConversationsService.openId })
    }

    // MARK: Akış

    @Test("Açılışta okundu işaretlenir ve okunmamış sayısı düşer")
    func marksReadOnOpen() async throws {
        let mock = service()
        #expect(try await mock.unreadCount() == 1)

        let store = ConversationThreadStore(service: mock, conversationId: MockConversationsService.openId)
        await store.load()

        #expect(store.conversation?.unread == false)
        #expect(try await mock.unreadCount() == 0)
    }

    @Test("Pencere açıkken serbest metin gider ve akışa eklenir")
    func sendsWhenWindowOpen() async {
        let store = ConversationThreadStore(service: service(), conversationId: MockConversationsService.openId)
        await store.load()
        #expect(store.canCompose)
        let before = store.messages.count

        let sent = await store.send("  Tabii, 15:00 uygun.  ")

        #expect(sent?.body == "Tabii, 15:00 uygun.")
        #expect(store.messages.count == before + 1)
        #expect(store.conversation?.lastMessageDirection == "out")
    }

    @Test("Boş mesaj gönderilmez")
    func ignoresEmptyMessage() async {
        let store = ConversationThreadStore(service: service(), conversationId: MockConversationsService.openId)
        await store.load()
        #expect(await store.send("   ") == nil)
        #expect(store.actionError == nil)
    }

    @Test("Pencere kapalıyken yazma kutusu yok, yalnız şablon; serbest metin 422 alır")
    func windowClosedRequiresTemplate() async {
        let store = ConversationThreadStore(service: service(), conversationId: MockConversationsService.closedWindowId)
        await store.load()

        #expect(!store.canCompose)
        #expect(store.needsTemplate)

        let sent = await store.send("Merhaba")
        #expect(sent == nil)
        guard case .problem(let problem) = store.actionError else {
            Issue.record("422 bekleniyordu")
            return
        }
        #expect(problem.code == .whatsappWindowClosed)
    }

    @Test("Şablon önerileri bağlı müşterinin adını taşır; gönderim işlenmiş metni ekler")
    func sendsTemplate() async throws {
        let mock = service()
        let store = ConversationThreadStore(service: mock, conversationId: MockConversationsService.closedWindowId)
        await store.load()

        let options = try await store.templateOptions()
        let starter = try #require(options.first { $0.name == "klinara_gelmedi_takip" })
        // Kayıtlı olmayan numara: müşteri adı önerilmez.
        #expect(starter.suggestedParameters.first == "")

        let message = try await store.sendTemplate(starter, values: ["Ayşe", "Nişantaşı"])
        #expect(message.isTemplate)
        #expect(message.body?.contains("Merhaba Ayşe, bugünkü randevunuza") == true)
        #expect(store.messages.last?.id == message.id)
        // Şablon pencereyi AÇMAZ.
        #expect(store.conversation?.windowOpen == false)
    }

    @Test("Eksik parametreli şablon reddedilir")
    func rejectsIncompleteTemplate() async throws {
        let store = ConversationThreadStore(service: service(), conversationId: MockConversationsService.closedWindowId)
        await store.load()
        let starter = try #require(try await store.templateOptions().first)

        await #expect(throws: APIError.self) {
            _ = try await store.sendTemplate(starter, values: ["Ayşe", ""])
        }
    }

    @Test("Kapatılan sohbet yeniden açılır")
    func closesAndReopens() async {
        let store = ConversationThreadStore(service: service(), conversationId: MockConversationsService.openId)
        await store.load()

        await store.setClosed(true)
        #expect(store.conversation?.isClosed == true)
        #expect(!store.canCompose && !store.needsTemplate)

        await store.setClosed(false)
        #expect(store.conversation?.isClosed == false)
    }

    @Test("Müşterisiz sohbet müşteriye bağlanır")
    func linksCustomer() async throws {
        let store = ConversationThreadStore(service: service(), conversationId: MockConversationsService.closedWindowId)
        await store.load()
        try await store.linkCustomer(MockCustomerSeed.ayse)
        #expect(store.conversation?.customer?.id == MockCustomerSeed.ayse)
    }

    @Test("Yoklama görev iptal edilince durur")
    func pollingStopsOnCancel() async throws {
        let mock = service()
        let store = ConversationThreadStore(service: mock, conversationId: MockConversationsService.openId)
        await store.load()

        let task = Task { await store.poll(every: .milliseconds(20)) }
        try await Task.sleep(for: .milliseconds(150))
        let whileVisible = mock.detailRequestCount
        #expect(whileVisible > 1)

        task.cancel()
        _ = await task.value
        let afterCancel = mock.detailRequestCount
        try await Task.sleep(for: .milliseconds(120))
        #expect(mock.detailRequestCount == afterCancel)
    }
}
