package com.klinara.android.features.notifications

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.notifications.Message
import com.klinara.android.services.notifications.MessageStatus
import com.klinara.android.services.notifications.NotificationChannel

/**
 * Tek bir mesajın hikâyesi (A8.1) — iOS `MessageDetailView` paritesi.
 *
 * Ekranın asıl işi `failed` ve `skipped` durumlarını **açıklamak**: sebep ayrı bir kartta,
 * çünkü durum kartının içinde bir satır olsaydı ekranın en önemli bilgisi en az göze çarpan
 * yerde dururdu.
 */
@Composable
fun MessageDetailScreen(
    message: Message,
    clock: BranchClock,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    KlinaraScreen(title = message.event.turkishName, modifier = modifier, onBack = onBack) {
        KlinaraCard(title = "Durum", footnote = message.status.explanation) {
            KlinaraRow(label = "Durum", value = message.status.turkishName)
            KlinaraDivider()
            KlinaraRow(label = "Kanal", value = message.channel.turkishName)
            KlinaraDivider()
            // Ham adres sunucuda da saklanmıyor — maskeli değer tek bildiğimiz.
            KlinaraRow(label = "Alıcı", value = message.to, detail = "Numara ve e-posta maskeli tutulur.")
            KlinaraDivider()
            KlinaraRow(label = "Olay türü", value = message.event.turkishName, detail = message.event.explanation)
        }

        if (message.status == MessageStatus.Failed || message.status == MessageStatus.Skipped) {
            DiagnosisCard(message)
        }

        KlinaraCard(title = "Zaman çizelgesi") {
            KlinaraRow(label = "Oluşturuldu", value = clock.formatDateTime(message.createdAt))
            KlinaraDivider()
            KlinaraRow(
                label = "Planlanan gönderim",
                value = clock.formatDateTime(message.scheduledFor),
                // Planlanan saatin oluşturulma saatinden ileride olması bir hata değil, bilinçli erteleme.
                detail =
                    "Sessiz saat nedeniyle ertelenmiş olabilir.".takeIf { message.scheduledFor > message.createdAt },
            )
            message.sentAt?.let {
                KlinaraDivider()
                KlinaraRow(label = "Gönderildi", value = clock.formatDateTime(it))
            }
            message.deliveredAt?.let {
                KlinaraDivider()
                KlinaraRow(label = "Ulaştı", value = clock.formatDateTime(it))
            }
        }

        if (message.subject != null || message.body != null) {
            KlinaraCard(
                title = "İçerik",
                footnote =
                    (
                        "WhatsApp'ta gönderilen metin Meta'daki onaylı şablondur; buradaki gövde " +
                            "kaydın kendi kopyasıdır."
                    ).takeIf { message.channel == NotificationChannel.WhatsApp },
            ) {
                message.subject?.let {
                    KlinaraRow(label = "Konu", value = it)
                    KlinaraDivider()
                }
                Text(message.body ?: "—", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoal)
            }
        }
    }
}

@Composable
private fun DiagnosisCard(message: Message) {
    val colors = KlinaraTheme.colors
    KlinaraCard(title = "Neden gönderilmedi") {
        val reason = message.failureMessage
        Text(
            reason ?: "Sunucu bir sebep kaydetmemiş.",
            style = KlinaraType.bodyM,
            color = if (reason == null) colors.charcoalMuted else colors.charcoal,
        )
        message.errorCode?.let {
            KlinaraDivider()
            // Ham kod destek kaydı için: kullanıcı dostu cümle bir gün değişse bile bu satır aynı kalır.
            KlinaraRow(label = "Hata kodu", value = it)
        }
        KlinaraDivider()
        KlinaraRow(
            label = "Deneme sayısı",
            value = message.attempt.toString(),
            detail =
                if (message.wasAttempted) {
                    "Sağlayıcıya iletilmeye çalışıldı."
                } else {
                    "Hiç denenmedi — engel gönderimden önce oluştu."
                },
        )
    }
}

/** Günlükte artık bulunmayan mesaj (süreç ölümü sonrası derin bağlantı) — dürüst bir boş ekran. */
@Composable
fun MissingMessageScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    KlinaraScreen(title = "Mesaj", modifier = modifier, onBack = onBack) {
        Text(
            "Bu mesaj artık listede değil. Mesaj günlüğüne dönüp yeniden açın.",
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.charcoalMuted,
        )
    }
}
