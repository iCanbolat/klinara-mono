import Foundation
import Testing
@testable import klinara_ios

/// Sohbet sözleşmesinin çözümleme testleri — gerçek sunucu gövdeleriyle.
@Suite("Sohbet çözümleme")
struct ConversationDecodingTests {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try APIClient.decoder.decode(T.self, from: Data(json.utf8))
    }

    @Test("Liste sayfası: müşterisiz sohbet, açık pencere ve cursor")
    func decodesListPage() throws {
        let page = try decode(Page<Conversation>.self, Fixtures.conversationListPage)

        let row = try #require(page.data.first)
        #expect(row.customer == nil)
        #expect(row.title == "+90 555 999 88 77")
        #expect(row.windowOpen)
        #expect(row.windowExpiresAt != nil)
        #expect(row.lastMessageDirection == "out")
        #expect(page.pageInfo.hasMore)
        #expect(page.pageInfo.nextCursor != nil)
    }

    @Test("Ayrıntı: pencere kapalı; gelen, serbest cevap ve şablon aynı akışta")
    func decodesDetail() throws {
        let detail = try decode(ConversationDetail.self, Fixtures.conversationDetailWindowClosed)

        #expect(detail.conversation.windowOpen == false)
        #expect(detail.conversation.customer?.fullName == "Ayşe Yılmaz")
        #expect(ConversationFormat.windowRemaining(detail.conversation) == nil)

        let types = detail.messages.map(\.type)
        #expect(types == ["text", "text", "template"])
        #expect(detail.messages.first?.isOutgoing == false)
        #expect(detail.messages.first?.status == nil)

        let template = try #require(detail.messages.last)
        #expect(template.isTemplate)
        #expect(template.status == .sent)
        #expect(template.senderLabel == "Klinik Sahibi · Şablon")
    }

    @Test("Şablon seçenekleri: bilinmeyen değişken adı `nil`, öneriler konum sırasıyla")
    func decodesTemplateOptions() throws {
        let options = try decode([ConversationTemplateOption].self, Fixtures.conversationTemplateOptions)

        let starter = try #require(options.first)
        #expect(starter.name == "klinara_gelmedi_takip")
        #expect(starter.variableNames == ["customerName", "branchName"])
        #expect(starter.label(at: 0) == "Müşteri adı")
        #expect(starter.suggestedParameters.first == "Ayşe Yılmaz")

        // Klinik Meta'da kendi açtığı şablonun değişken adını bilmiyoruz.
        let custom = try #require(options.last)
        #expect(custom.variableNames == [nil])
        #expect(custom.label(at: 0) == "1. değişken")
    }

    @Test("Başarısız gönderim HTTP hatası değil — `failed` mesaj ve sebebi")
    func decodesFailedMessage() throws {
        let message = try decode(ConversationMessage.self, Fixtures.conversationMessageFailed)

        #expect(message.isFailed)
        #expect(message.errorDetail?.isEmpty == false)
    }

    @Test("Şablon gönderimi `template` tipinde döner")
    func decodesTemplateSent() throws {
        let message = try decode(ConversationMessage.self, Fixtures.conversationTemplateSent)

        #expect(message.isTemplate)
        #expect(message.body?.contains("Nişantaşı") == true)
    }

    @Test("Pencere kapalı hatası kendi koduyla çözülür")
    func decodesWindowClosedProblem() throws {
        let problem = try decode(ProblemDetails.self, Fixtures.conversationWindowClosedProblem)

        #expect(problem.code == .whatsappWindowClosed)
        #expect(problem.status == 422)
    }

    @Test("Okunmamış sayısı")
    func decodesUnreadCount() throws {
        #expect(try decode(UnreadConversationCount.self, Fixtures.conversationUnreadCount).count >= 0)
    }

    @Test("Şablon önizlemesi: dolu değer yerleşir, boş değer yer tutucuyu korur")
    func rendersTemplate() throws {
        let option = try #require(
            try decode([ConversationTemplateOption].self, Fixtures.conversationTemplateOptions).first
        )
        #expect(option.render(["Ayşe", "Kadıköy"]).hasPrefix("Merhaba Ayşe, bugünkü randevunuza"))
        #expect(option.render(["Ayşe", " "]).contains("{{2}}"))
        #expect(option.isComplete(["Ayşe", "Kadıköy"]))
        #expect(!option.isComplete(["Ayşe", ""]))
    }
}
