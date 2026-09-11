package com.klinara.android.features.shell

import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.contracts.Permissions

/** Yönetim hub'ından açılan hedefler. Route'a çevirme `AppShell`'in işi. */
enum class ManagementDestination {
    Services,
    ServiceCategories,
    Staff,
    BranchHours,
    ScheduleExceptions,
    CustomerTags,
    PackageDefinitions,
    PackageReports,
    Inbox,
    MessageLog,
    ReminderSettings,
    NotificationTemplates,
    NotificationPreferences,
    WhatsApp,
}

data class ManagementRow(
    val destination: ManagementDestination,
    val label: String,
    val detail: String,
)

data class ManagementSection(
    val title: String,
    val rows: List<ManagementRow>,
    val footnote: String? = null,
)

/**
 * Yönetim hub'ının kart kümesi — **saf bir fonksiyon** (izin kümesi → kartlar).
 *
 * `ShellTab.visibleFor` ile aynı gerekçe: altı rolün matrisi emülatörde gezilmeden birim
 * testiyle doğrulanır (`ManagementSectionsTest`). iOS `ManagementHomeView` gibi kapı
 * **kart** düzeyinde: kartı görmek okuma izni ister; yazma izni ekranların içinde sorulur
 * (salt okunur açılırlar).
 *
 * **Sahte satır yok** — açılmayan bir satır, var olmayan bir özellik vaat eder. Henüz
 * gelmemiş fazlar tek bir "Yakında" kartında metin olarak anılır.
 */
fun managementSections(session: AppSession): List<ManagementSection> =
    buildList {
        if (session.can(Permissions.SERVICE_READ)) {
            add(
                section(
                    "Katalog",
                    row(ManagementDestination.Services, "Hizmetler", "Süre, hazırlık payı, fiyat ve şube farkları"),
                    row(ManagementDestination.ServiceCategories, "Kategoriler", "Hizmetlerin gruplanması ve sırası"),
                ),
            )
        }
        if (session.can(Permissions.STAFF_READ)) {
            add(
                section(
                    "Ekip",
                    row(ManagementDestination.Staff, "Personel", "Profil, uzmanlık ve hizmet yetkinlikleri"),
                    footnote = "Bir personele yetkin olmadığı hizmetten randevu açılamaz.",
                ),
            )
        }
        if (session.can(Permissions.SCHEDULE_READ)) {
            add(
                section(
                    "Takvim kurulumu",
                    row(ManagementDestination.BranchHours, "Şube çalışma saatleri", "Açılış, kapanış ve mola"),
                    row(
                        ManagementDestination.ScheduleExceptions,
                        "İzin ve istisnalar",
                        "Tatil, yarım gün, tekrarlı izinler",
                    ),
                    footnote =
                        session.activeBranch?.let {
                            "Saatler ${it.name} şubesinin saat diliminde (${it.timezone}) gösterilir."
                        },
                ),
            )
        }
        if (session.can(Permissions.CUSTOMER_READ)) {
            add(
                section(
                    "Müşteriler",
                    row(ManagementDestination.CustomerTags, "Müşteri etiketleri", "Kiracı genelinde tanımlı etiketler"),
                ),
            )
        }
        if (session.can(Permissions.PACKAGE_READ)) {
            add(
                section(
                    "Paketler",
                    row(
                        ManagementDestination.PackageDefinitions,
                        "Paket tanımları",
                        "Satılabilir seans paketleri ve fiyatları",
                    ),
                    row(
                        ManagementDestination.PackageReports,
                        "Paket raporları",
                        "Yükümlülük, süre dolumu ve dönem kullanımı",
                    ),
                ),
            )
        }
        communicationSection(session)?.let(::add)
    }

/**
 * İletişim kartı (A8) — iOS `communicationCard` paritesi: `notification:read` ya da `:manage`.
 *
 * Okuma satırları `notification:read` ister; kart yalnız `:manage` ile de görünür (iOS'ta
 * WhatsApp satırı böyle tek başına kalabiliyor). Bugün hiçbir rol `:manage`'i `:read`'siz
 * taşımıyor ama kapı sözleşmeye göre yazılıyor, rol tablosuna göre değil.
 */
private fun communicationSection(session: AppSession): ManagementSection? {
    val rows =
        buildList {
            if (session.can(Permissions.NOTIFICATION_READ)) {
                add(row(ManagementDestination.Inbox, "Gelen kutusu", "Müşterilerin WhatsApp'tan yazdığı mesajlar"))
                add(
                    row(
                        ManagementDestination.MessageLog,
                        "Mesaj günlüğü",
                        "Gönderilen, ulaşan ve gönderilmeyen mesajlar",
                    ),
                )
                add(
                    row(
                        ManagementDestination.ReminderSettings,
                        "Hatırlatma ayarları",
                        "Randevudan kaç saat önce, gelmedi takibi",
                    ),
                )
                add(
                    row(
                        ManagementDestination.NotificationTemplates,
                        "Bildirim şablonları",
                        "Olay ve kanal başına mesaj metni",
                    ),
                )
                add(
                    row(
                        ManagementDestination.NotificationPreferences,
                        "Bildirim tercihleri",
                        "Kanal önceliği ve sessiz saatler",
                    ),
                )
            }
            // Kimlik bilgileri `notification:manage` (receptionist görmez); test gönderimi ekranın içinde
            // `notification:send` ile ayrıca sorulur.
            if (session.can(Permissions.NOTIFICATION_MANAGE)) {
                add(
                    row(
                        ManagementDestination.WhatsApp,
                        "WhatsApp entegrasyonu",
                        "WABA kimlik bilgileri, şablonlar ve test gönderimi",
                    ),
                )
            }
        }
    if (rows.isEmpty()) return null
    return ManagementSection(
        title = "İletişim",
        rows = rows,
        footnote =
            "Randevu hatırlatması ticari ileti değildir; iletişim izni iptali yalnız pazarlama " +
                "mesajlarını durdurur.",
    )
}

private fun section(
    title: String,
    vararg rows: ManagementRow,
    footnote: String? = null,
) = ManagementSection(title = title, rows = rows.toList(), footnote = footnote)

private fun row(
    destination: ManagementDestination,
    label: String,
    detail: String,
) = ManagementRow(destination, label, detail)

/**
 * Yönetim kökü — iOS `ManagementHomeView` paritesi.
 *
 * A2'de bir `ComingSoon`, A4.2–A5'te `AppShell.kt` içinde private bir ara çözümdü; A7.1'de
 * kendi dosyasına ve [managementSections]'a taşındı.
 */
@Composable
fun ManagementHomeScreen(
    session: AppSession,
    onOpen: (ManagementDestination) -> Unit,
    trailing: @Composable RowScope.() -> Unit,
    modifier: Modifier = Modifier,
) {
    KlinaraScreen(title = "Yönetim", modifier = modifier, trailing = trailing) {
        Text(
            text = "${session.activeBranch?.name ?: "Klinik"} · Hizmetler, ekip ve çalışma saatleri buradan yönetilir.",
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.charcoalMuted,
        )

        managementSections(session).forEach { section ->
            KlinaraCard(title = section.title, footnote = section.footnote) {
                section.rows.forEach { row ->
                    KlinaraNavigationRow(
                        label = row.label,
                        value = row.detail,
                        onClick = { onOpen(row.destination) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }

        KlinaraCard(title = "Yakında") {
            Text(
                text = COMING_SOON,
                style = KlinaraType.bodyM,
                color = KlinaraTheme.colors.charcoalMuted,
            )
        }
    }
}

private const val COMING_SOON =
    "Kasa ve prim Faz A6, raporlar Faz A9 ile geliyor."
