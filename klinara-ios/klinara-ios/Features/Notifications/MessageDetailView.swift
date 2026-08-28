import SwiftUI

/// Tek bir mesajın hikâyesi: ne zaman planlandı, ne zaman gitti, ulaştı mı,
/// ulaşmadıysa neden.
///
/// Ekranın asıl işi `failed` ve `skipped` durumlarını **açıklamak**. Bir durum
/// rozetiyle yetinmek, "gönderilmedi" yazıp sebebini söylememek olurdu; oysa
/// sunucu sebebi biliyor (`errorCode`) ve operasyonun bakacağı yer ona bağlı.
struct MessageDetailView: View {

    let session: AppSession
    let message: Message

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                statusCard
                if message.status == .failed || message.status == .skipped {
                    diagnosisCard
                }
                timelineCard
                contentCard
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle(message.event.turkishName)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var statusCard: some View {
        KlinaraCard(title: "Durum", footnote: message.status.explanation) {
            KlinaraRow(label: "Durum", value: message.status.turkishName)
            KlinaraDivider()
            KlinaraRow(label: "Kanal", value: message.channel.turkishName)
            KlinaraDivider()
            // Ham adres sunucuda da saklanmıyor — maskeli değer tek bildiğimiz.
            KlinaraRow(
                label: "Alıcı",
                value: message.to,
                detail: "Numara ve e-posta maskeli tutulur."
            )
            KlinaraDivider()
            KlinaraRow(label: "Olay türü", value: message.event.turkishName, detail: message.event.explanation)
        }
    }

    /// Başarısız ve atlanmış mesajlarda sebep ayrı bir kartta: durum kartının
    /// içinde bir satır olsaydı, ekranın en önemli bilgisi en az göze çarpan
    /// yerde dururdu.
    private var diagnosisCard: some View {
        KlinaraCard(title: "Neden gönderilmedi") {
            // ``KlinaraCard`` içeriğine yatay boşluk EKLEMEZ; serbest içerik
            // dolgusunu kendisi taşır (``KlinaraRow`` ile aynı `md`).
            Text(message.failureMessage ?? "Sunucu bir sebep kaydetmemiş.")
                .klinaraText(.bodyM)
                .foregroundStyle(
                    message.failureMessage == nil
                        ? KlinaraColor.charcoalMuted
                        : KlinaraColor.charcoal
                )
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(KlinaraMetrics.md)

            if let code = message.errorCode {
                KlinaraDivider()
                // Ham kod destek kaydı için duruyor: kullanıcı dostu cümle
                // sunucuda bir gün değişse bile bu satır aynı kalır.
                KlinaraRow(label: "Hata kodu", value: code, isMonospaced: true)
            }

            KlinaraDivider()
            KlinaraRow(
                label: "Deneme sayısı",
                value: "\(message.attempt)",
                detail: message.wasAttempted
                    ? "Sağlayıcıya iletilmeye çalışıldı."
                    : "Hiç denenmedi — engel gönderimden önce oluştu."
            )
        }
    }

    private var timelineCard: some View {
        KlinaraCard(title: "Zaman çizelgesi") {
            KlinaraRow(
                label: "Oluşturuldu",
                value: session.clock.formatDateTime(message.createdAt)
            )
            KlinaraDivider()
            KlinaraRow(
                label: "Planlanan gönderim",
                value: session.clock.formatDateTime(message.scheduledFor),
                // Sessiz saat penceresi şube saat diliminde yorumlanıyor;
                // planlanan saatin oluşturulma saatinden ileride olması bir
                // hata değil, bilinçli erteleme.
                detail: message.scheduledFor > message.createdAt
                    ? "Sessiz saat nedeniyle ertelenmiş olabilir."
                    : nil
            )
            if let sentAt = message.sentAt {
                KlinaraDivider()
                KlinaraRow(label: "Gönderildi", value: session.clock.formatDateTime(sentAt))
            }
            if let deliveredAt = message.deliveredAt {
                KlinaraDivider()
                KlinaraRow(label: "Ulaştı", value: session.clock.formatDateTime(deliveredAt))
            }
        }
    }

    @ViewBuilder
    private var contentCard: some View {
        if message.subject != nil || message.body != nil {
            KlinaraCard(
                title: "İçerik",
                footnote: message.channel == .whatsapp
                    ? "WhatsApp'ta gönderilen metin Meta'daki onaylı şablondur; buradaki gövde kaydın kendi kopyasıdır."
                    : nil
            ) {
                if let subject = message.subject {
                    KlinaraRow(label: "Konu", value: subject)
                    KlinaraDivider()
                }
                Text(message.body ?? "—")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(KlinaraMetrics.md)
            }
        }
    }
}
