package com.klinara.android.features.shell

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.ui.graphics.vector.ImageVector
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.contracts.Permissions
import kotlinx.serialization.Serializable

/**
 * Alt gezinme sekmeleri.
 *
 * **Sekme kümesi kalıcıdır.** A3–A9 sekme EKLEMEZ, var olanı doldurur; bilgi
 * mimarisini her fazda yeniden kurmak kullanıcının kas hafızasını her sürümde
 * sıfırlamak demektir. iOS `AppShellView` ile birebir aynı beşli.
 *
 * **Dashboard bu kuralın bilinçli istisnası** ve AÇILIŞ sekmesi: web panelin açılış
 * sayfasının karşılığı. Önce Yönetim hub'ının bir satırıydı; günün ilk sorusuna ("bugün
 * ve bu ay nasıl?") üç dokunuşla ulaşmak açılış ekranı olmasının önüne geçiyordu. Eski
 * "Bugün" sekmesi aynı anda "Takvim" adını aldı — "bugün"ün cevabı artık Dashboard.
 *
 * Görünürlük **saf bir fonksiyondur** (izin kümesi → sekme kümesi): bu yüzden
 * `ShellTabTest` altı rolün altısını da elle emülatör gezmeden doğrulayabiliyor.
 */
enum class ShellTab(
    val label: String,
    val icon: ImageVector,
) {
    Dashboard("Dashboard", Icons.Filled.Home),
    Calendar("Takvim", Icons.Filled.DateRange),
    Customers("Müşteriler", Icons.Filled.Person),
    Management("Yönetim", Icons.Filled.Settings),
    Profile("Profil", Icons.Filled.AccountCircle),
    ;

    fun isVisible(session: AppSession): Boolean =
        when (this) {
            // Dashboard, Takvim ve Profil HER ZAMAN çizilir. Varsayılan seçili sekmenin
            // bazı rollerde kaybolması, bilgi mimarisini role göre değiştirmek olurdu;
            // izin yoksa sekme durur ama içerik "erişiminiz yok" der.
            Dashboard, Calendar, Profile -> true
            Customers -> session.can(Permissions.CUSTOMER_READ)
            Management -> session.canAny(MANAGEMENT_PERMISSIONS)
        }

    companion object {
        /**
         * Yönetim sekmesini açan izinler.
         *
         * **Finans izinlerinin burada olması iOS'ta bir DÜZELTMEYDİ.** `accountant`
         * rolünde `service:read`, `staff:read`, `schedule:read` yok; eski koşulla
         * muhasebe sekmeyi hiç göremiyor, dolayısıyla kendisi için yazılmış Kasa ve
         * Prim ekranlarına da hiç ulaşamıyordu.
         *
         * **`package:read` A5.1'de eklendi**, aynı sınıftan bir hatayı önlemek için:
         * paket tanımları ve raporları Yönetim'de yaşıyor. Bugün her paket izni olan rol
         * sekmeyi zaten başka bir izinle görüyor, ama koşul "şans eseri doğru" olmamalı —
         * paket ekranına götüren izin sekmeyi de açmalı.
         */
        val MANAGEMENT_PERMISSIONS =
            setOf(
                Permissions.SERVICE_READ,
                Permissions.STAFF_READ,
                Permissions.SCHEDULE_READ,
                Permissions.FINANCE_PAYMENT_READ,
                Permissions.FINANCE_COMMISSION_READ,
                Permissions.NOTIFICATION_READ,
                Permissions.NOTIFICATION_MANAGE,
                Permissions.PACKAGE_READ,
            )

        fun visibleFor(session: AppSession): List<ShellTab> = entries.filter { it.isVisible(session) }

        /**
         * Takvim içeriği çizilsin mi?
         *
         * Sekmenin görünürlüğünden AYRI bir soru: `accountant` sekmeyi görür ama
         * randevuları göremez.
         */
        fun canSeeCalendar(session: AppSession): Boolean =
            session.canAny(Permissions.APPOINTMENT_READ_ALL, Permissions.APPOINTMENT_READ_OWN)
    }
}

/**
 * Sekme başına gezinme grafiğinin başlangıç hedefleri.
 *
 * A2'de her grafiğin tek hedefi var; tip güvenli route'lar yine de şimdi kuruluyor ki
 * A3–A9 ekran eklerken kabuk yeniden yazılmasın.
 */
object ShellRoutes {
    /** Dashboard sekmesinin kökü — web `/dashboard` paritesi. */
    @Serializable
    data object Dashboard

    @Serializable
    data object TodayHome

    /**
     * Randevu detayı — bir sheet DEĞİL, gerçek bir hedef (§5.3, Kural 2).
     *
     * iOS'ta bu bir `sheet`; Android'de geri yığınında bir kayıt olmalı ki tahmini geri
     * (predictive back) ve sistem geri tuşu kendiliğinden çalışsın. A2.1'de sekme başına
     * `NavHost` kurmanın sebebi tam buydu.
     */
    @Serializable
    data class AppointmentDetail(
        val appointmentId: String,
    )

    @Serializable
    data class AppointmentHistory(
        val appointmentId: String,
    )

    /**
     * Randevu oluşturma / erteleme.
     *
     * [rescheduleId] doluysa bu bir ERTELEME. İki ayrı hedef yerine tek hedef: form
     * aynı, değişen yalnız kilitli alanlar ve düğme metni; ikiye bölmek aynı ekranı iki
     * kez yazmak olurdu.
     */
    @Serializable
    data class BookingFlow(
        val rescheduleId: String? = null,
    )

    @Serializable
    data object CustomerList

    /**
     * Müşteri kartı — sheet DEĞİL, gerçek bir hedef (randevu detayıyla aynı gerekçe).
     *
     * Argümanda **yalnız kimlik** taşınıyor; kaydın kendisini taşımak bir ekranın
     * gerçeğini başka bir ekranın hafızasına bağlar ve bayatlamaya davetiye çıkarır.
     */
    @Serializable
    data class CustomerDetail(
        val customerId: String,
    )

    /**
     * Müşteri oluşturma / düzenleme. [customerId] null ise YENİ kayıt.
     *
     * İki ayrı hedef yerine tek hedef: form aynı, değişen yalnız başlangıç değerleri ve
     * düğme metni. `BookingFlow`un oluşturma/erteleme kararının aynısı.
     */
    @Serializable
    data class CustomerEditor(
        val customerId: String? = null,
    )

    @Serializable
    data class CustomerMerge(
        val customerId: String,
    )

    /** Not editörü — [noteId] null ise YENİ not. */
    @Serializable
    data class NoteEditor(
        val customerId: String,
        val noteId: String? = null,
    )

    @Serializable
    data class NoteRevisions(
        val customerId: String,
        val noteId: String,
    )

    /**
     * Dosya yükleme. [groupId] ve [position] doluysa öncesi/sonrası slotundan
     * geliniyor demektir ve ekran ikisini bir daha SORMAZ.
     */
    @Serializable
    data class FileUpload(
        val customerId: String,
        val isPhoto: Boolean,
        val groupId: String? = null,
        val position: String? = null,
    )

    @Serializable
    data class PhotoGroups(
        val customerId: String,
    )

    @Serializable
    data class PhotoDetail(
        val customerId: String,
        val fileId: String,
    )

    @Serializable
    data class DocumentPreview(
        val customerId: String,
        val fileId: String,
    )

    @Serializable
    data object ManagementHome


    /** Etiketler KİRACI kapsamlı: Yönetim sekmesinde yaşar, müşteri kartında değil. */
    @Serializable
    data object CustomerTagList

    /** Paket tanımları (A5.1) — kiracı kapsamlı şablonlar, Yönetim sekmesinde yaşar. */
    @Serializable
    data object PackageDefinitionList

    /** Tanım oluşturma / düzenleme. [definitionId] null ise YENİ tanım. */
    @Serializable
    data class PackageDefinitionEditor(
        val definitionId: String? = null,
    )

    /** Paket satışı (A5.2) — sheet değil, hedef. Satış SEÇİLİ ŞUBEDE yapılır. */
    @Serializable
    data class SellPackage(
        val customerId: String,
    )

    /**
     * Müşteri paketi detayı. Yalnız KİMLİK taşınır: iade/düzeltme sonrası ekran taze kayda
     * bakmalı, açılışta kopyalanmış bayat bir modele değil.
     */
    @Serializable
    data class CustomerPackageDetail(
        val packageId: String,
    )

    /**
     * Paket işlemi (A5.3) — düzeltme / iade / devir. [operation] `PackageOperation.wire`.
     * Üç ayrı hedef yerine tek hedef: yükleme, sürüm ve gerekçe ortak; değişen form ve izin.
     */
    @Serializable
    data class PackageOperation(
        val packageId: String,
        val operation: String,
    )

    /** Randevu satırını pakete bağlama (A5.2) — randevu detayından açılır. */
    @Serializable
    data class BindPackage(
        val appointmentId: String,
        val appointmentServiceId: String,
    )

    /**
     * Paket raporları (A5.4). Giriş hedefi, üç raporun PAYLAŞTIĞI ViewModel'in sahibi;
     * rapor hedefleri [PackageReport] ile açılır.
     */
    @Serializable
    data object PackageReportsHome

    /** [screen] `PackageReportScreen.name` — Outstanding / Expiring / Usage. */
    @Serializable
    data class PackageReport(
        val screen: String,
    )

    /**
     * Klinik raporları (A9). Giriş hedefi, beş raporun PAYLAŞTIĞI ViewModel'in sahibi (ortak
     * dönem ve karşılaştırma); rapor hedefleri [Report] ile açılır.
     */
    @Serializable
    data object ReportsHome

    /** [kind] `ReportKind.name` — Occupancy / Revenue / StaffPerformance / NoShow / Retention. */
    @Serializable
    data class Report(
        val kind: String,
    )

    /** Hizmet kataloğu (A7.1). */
    @Serializable
    data object ServiceList

    /** Hizmet oluşturma / düzenleme. [serviceId] null ise YENİ hizmet. */
    @Serializable
    data class ServiceEditor(
        val serviceId: String? = null,
    )

    /** Hizmet kategorileri (A7.1). Editör bir diyalog, ayrı hedef değil. */
    @Serializable
    data object ServiceCategoryList

    /** Personel (A7.2). */
    @Serializable
    data object StaffList

    /** Yeni personel profili — oluşunca yerini detaya bırakır. */
    @Serializable
    data object StaffCreate

    @Serializable
    data class StaffDetail(
        val staffId: String,
    )

    /** Personel–hizmet yetkinlik matrisi. */
    @Serializable
    data class StaffServiceMatrix(
        val staffId: String,
    )

    /** Personelin rolleri ve şubeleri (A7.5). [userName] başlık için; kayıt yeniden çekilir. */
    @Serializable
    data class MembershipEditor(
        val userId: String,
        val userName: String,
    )

    /** Bekleyen davetler (A7.5). */
    @Serializable
    data object InvitationList

    /** Personel davet formu (A7.5). */
    @Serializable
    data object InviteStaff

    /** Şubeler (A7.4). */
    @Serializable
    data object BranchList

    /** Şube formu. [branchId] null → yeni şube. */
    @Serializable
    data class BranchEditor(
        val branchId: String? = null,
    )

    /** Şube çalışma saatleri (A7.3) — SEÇİLİ şubenin. */
    @Serializable
    data object BranchHours

    /** Personelin seçili şubedeki haftalık programı. */
    @Serializable
    data class StaffSchedule(
        val staffId: String,
    )

    /** İzin ve istisnalar. [staffId] null ise şube geneli. */
    @Serializable
    data class ScheduleExceptionList(
        val staffId: String? = null,
    )

    /** Yeni istisna. [staffId] verilirse personel ön seçili. */
    @Serializable
    data class ScheduleExceptionEditor(
        val staffId: String? = null,
    )

    /** Gelen kutusu (A8.1). */
    @Serializable
    data object Inbox

    /** Mesaj günlüğü (A8.1) — detayla PAYLAŞILAN ViewModel'in sahibi. */
    @Serializable
    data object MessageLog

    /** Tek mesaj. Yalnız kimlik taşınır; kayıt [MessageLog]'un ViewModel'inden okunur. */
    @Serializable
    data class MessageDetail(
        val messageId: String,
    )

    /** Hatırlatma ayarları (A8.2) — SEÇİLİ şubenin. */
    @Serializable
    data object ReminderSettings

    /** Bildirim şablonları (A8.2) — editörle PAYLAŞILAN ViewModel'in sahibi. */
    @Serializable
    data object NotificationTemplates

    /** [rowId] `event|channel|locale` — sunucunun upsert anahtarı. */
    @Serializable
    data class NotificationTemplateEditor(
        val rowId: String,
    )

    /** Bildirim tercihleri (A8.2). */
    @Serializable
    data object NotificationPreferences

    /** [rowId] `event|branchId` (kiracı satırında `tenant`). */
    @Serializable
    data class NotificationPreferenceEditor(
        val rowId: String,
    )

    /** WhatsApp entegrasyonu (A8.3) — editör, şablon ve test hedefleriyle PAYLAŞILAN ViewModel'in sahibi. */
    @Serializable
    data object WhatsAppSettings

    @Serializable
    data object WhatsAppEditor

    @Serializable
    data object WhatsAppTemplates

    @Serializable
    data object WhatsAppTest

    @Serializable
    data object ProfileHome
}
