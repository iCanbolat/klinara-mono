package com.klinara.android.features.shell

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraIcons
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.reports.ReportAccess
import com.klinara.android.services.contracts.Permissions

/** Yönetim hub'ından açılan hedefler. Route'a çevirme `AppShell`'in işi. */
enum class ManagementDestination {
    Services,
    ServiceCategories,
    Staff,
    Branches,
    Invitations,
    BranchHours,
    ScheduleExceptions,
    CustomerTags,
    PackageDefinitions,
    PackageReports,
    Reports,
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
        teamSection(session)?.let(::add)
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
                    row(ManagementDestination.CustomerTags, "Müşteri etiketleri", "VIP, hassas cilt, kampanya…"),
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
                        "Kalemler, fiyat, geçerlilik ve devir kuralı",
                    ),
                ),
            )
        }
        communicationSection(session)?.let(::add)
        reportsSection(session)?.let(::add)
    }

/**
 * "Şube ve Personel" (A7.4–A7.5) — web panelindeki ekranın ve iOS `teamCard`ın karşılığı. Kapı
 * `staff:read`: `branch:read` HER rolde var ve kapı olsaydı personel izni olmayan bir rol yalnız
 * şube listesinden ibaret bir kart görürdü. Şubeler `branch:read`, davetler `user:invite` ile satır olarak eklenir.
 */
private fun teamSection(session: AppSession): ManagementSection? {
    if (!session.can(Permissions.STAFF_READ)) return null
    val rows =
        buildList {
            add(row(ManagementDestination.Staff, "Personel", "Profil, roller, şubeler ve hizmet yetkinlikleri"))
            if (session.can(Permissions.BRANCH_READ)) {
                add(
                    row(
                        ManagementDestination.Branches,
                        "Şubeler",
                        if (session.can(Permissions.BRANCH_WRITE)) {
                            "Şube ekleme, iletişim ve pasife alma"
                        } else {
                            "Kliniğin şubeleri"
                        },
                    ),
                )
            }
            if (session.can(Permissions.USER_INVITE)) {
                add(row(ManagementDestination.Invitations, "Davetler", "Yeni personel davet et, bekleyenleri iptal et"))
            }
        }
    return ManagementSection(
        title = "Şube ve Personel",
        rows = rows,
        footnote = "Bir personele yetkin olmadığı hizmetten randevu açılamaz.",
    )
}

/**
 * Raporlar kartı (A9) — iOS `reportsCard` paritesi: klinik ve paket raporları TEK kartta, en
 * sonda. Paket raporları A5.4'te Paketler kartındaydı; iOS'taki yerine taşındı.
 *
 * Klinik raporları satırı, beş rapordan EN AZ BİRİ açılabiliyorsa görünür ([ReportAccess]);
 * hangilerinin açıldığı giriş ekranında ayrıca süzülür.
 */
private fun reportsSection(session: AppSession): ManagementSection? {
    val rows =
        buildList {
            if (ReportAccess.visible(session::can).isNotEmpty()) {
                add(
                    row(
                        ManagementDestination.Reports,
                        "Klinik raporları",
                        "Doluluk, ciro, personel performansı, gelmeme ve kazanım",
                    ),
                )
            }
            if (session.can(Permissions.PACKAGE_READ)) {
                add(
                    row(
                        ManagementDestination.PackageReports,
                        "Paket raporları",
                        "Yükümlülük, süre dolumu ve dönem kullanımı",
                    ),
                )
            }
        }
    if (rows.isEmpty()) return null
    return ManagementSection(
        title = "Raporlar",
        rows = rows,
        footnote = "Dönemler yarı açıktır: bitiş günü dahil değildir; ekranda son gün yazılır.",
    )
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
 * Satırın ikonu — iOS `ManagementHomeView`'daki SF Symbol seçiminin birebir karşılığı.
 *
 * Eşleme `when` ile yazıldı, haritayla değil: yeni bir hedef eklendiğinde derleyici
 * ikonunu sorar. Satırların çoğunun ikonu, kartın başlığı okunmadan da ne olduğunu
 * söyler — on yedi satırlık düz metin bir liste taranamıyordu.
 */
@get:DrawableRes
val ManagementDestination.icon: Int
    get() =
        when (this) {
            ManagementDestination.Services -> KlinaraIcons.services
            ManagementDestination.ServiceCategories -> KlinaraIcons.categories
            ManagementDestination.Staff -> KlinaraIcons.staff
            ManagementDestination.Branches -> KlinaraIcons.branch
            ManagementDestination.Invitations -> KlinaraIcons.invite
            ManagementDestination.BranchHours -> KlinaraIcons.clock
            ManagementDestination.ScheduleExceptions -> KlinaraIcons.calendarException
            ManagementDestination.CustomerTags -> KlinaraIcons.tag
            ManagementDestination.PackageDefinitions -> KlinaraIcons.packageBox
            ManagementDestination.PackageReports -> KlinaraIcons.packageReports
            ManagementDestination.Reports -> KlinaraIcons.reports
            ManagementDestination.Inbox -> KlinaraIcons.inbox
            ManagementDestination.MessageLog -> KlinaraIcons.messages
            ManagementDestination.ReminderSettings -> KlinaraIcons.reminder
            ManagementDestination.NotificationTemplates -> KlinaraIcons.template
            ManagementDestination.NotificationPreferences -> KlinaraIcons.preferences
            ManagementDestination.WhatsApp -> KlinaraIcons.link
        }

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
                section.rows.forEachIndexed { index, row ->
                    if (index > 0) KlinaraDivider()
                    KlinaraNavigationRow(
                        label = row.label,
                        value = row.detail,
                        onClick = { onOpen(row.destination) },
                        modifier = Modifier.fillMaxWidth(),
                        icon = row.destination.icon,
                    )
                }
            }
        }
    }
}
