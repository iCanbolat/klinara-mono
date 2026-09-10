// ÜRETİLMİŞTİR — ELLE DÜZENLEMEYİN.
//
// Kaynak: packages/shared/src/{error-codes,permissions}.ts
// Yeniden üretmek için: pnpm gen:contracts
//
// Bu dosyayı elle değiştirmek, sunucu sözleşmesiyle istemciyi sessizce ayrıştırır.

package com.klinara.android.services.contracts

/**
 * İzin anahtarları.
 *
 * **İstemci izni bir güvenlik sınırı DEĞİLDİR** — sunucu her uçta zaten kontrol
 * ediyor. Buradaki kontrol yalnız bir kullanılabilirlik kararıdır: yetkisi olmayana
 * düğmeyi gösterip içeride 403 vermek, ona yapamayacağı bir şeyi vaat etmektir.
 *
 * İzin adları elle yazılmaz, bu sabitlerden geçer: yanlış yazılan bir izin sessizce
 * `false` döner ve özellik hiç görünmez.
 */
object Permissions {
    const val TENANT_READ = "tenant:read"
    const val TENANT_WRITE = "tenant:write"
    const val BRANCH_READ = "branch:read"
    const val BRANCH_WRITE = "branch:write"
    const val USER_READ = "user:read"
    const val USER_WRITE = "user:write"
    const val USER_INVITE = "user:invite"
    const val APPOINTMENT_READ_OWN = "appointment:read.own"
    const val APPOINTMENT_READ_ALL = "appointment:read.all"
    const val APPOINTMENT_WRITE = "appointment:write"
    const val APPOINTMENT_REOPEN = "appointment:reopen"
    const val SERVICE_READ = "service:read"
    const val SERVICE_WRITE = "service:write"
    const val STAFF_READ = "staff:read"
    const val STAFF_WRITE = "staff:write"
    const val SCHEDULE_READ = "schedule:read"
    const val SCHEDULE_WRITE = "schedule:write"
    const val RESOURCE_READ = "resource:read"
    const val RESOURCE_WRITE = "resource:write"
    const val CUSTOMER_READ = "customer:read"
    const val CUSTOMER_WRITE = "customer:write"
    const val CUSTOMER_MERGE = "customer:merge"
    const val CUSTOMER_MEDICAL_READ = "customer.medical:read"
    const val CUSTOMER_MEDICAL_WRITE = "customer.medical:write"
    const val PACKAGE_READ = "package:read"
    const val PACKAGE_WRITE = "package:write"
    const val PACKAGE_REFUND = "package:refund"
    const val PACKAGE_TRANSFER = "package:transfer"
    const val FINANCE_PAYMENT_READ = "finance.payment:read"
    const val FINANCE_PAYMENT_WRITE = "finance.payment:write"
    const val FINANCE_PRICE_OVERRIDE = "finance.price:override"
    const val FINANCE_COMMISSION_READ = "finance.commission:read"
    const val FINANCE_COMMISSION_WRITE = "finance.commission:write"
    const val REPORT_REVENUE_READ = "report.revenue:read"
    const val REPORT_PERFORMANCE_READ_OWN = "report.performance:read.own"
    const val CONSENT_READ = "consent:read"
    const val CONSENT_MANAGE = "consent:manage"
    const val NOTIFICATION_SEND = "notification:send"
    const val NOTIFICATION_READ = "notification:read"
    const val NOTIFICATION_MANAGE = "notification:manage"
    const val BOOKING_PAGE_READ = "booking_page:read"
    const val BOOKING_PAGE_MANAGE = "booking_page:manage"
    const val AUDIT_READ = "audit:read"
}

/** Rol anahtarı → Türkçe görünen ad. Kiracı/şube seçim ekranlarında kullanılır. */
object RoleNames {
    private val byKey =
        mapOf(
        "platform_admin" to "Platform Yöneticisi",
        "owner" to "İşletme Sahibi",
        "manager" to "Şube Yöneticisi",
        "accountant" to "Muhasebe",
        "receptionist" to "Resepsiyon",
        "practitioner" to "Uygulayıcı",
        )

    /** Bilinmeyen bir rol anahtarı olduğu gibi gösterilir — boş satır göstermekten iyidir. */
    fun turkish(roleKey: String): String = byKey[roleKey] ?: roleKey

    fun turkish(roleKeys: List<String>): String = roleKeys.joinToString(", ", transform = ::turkish)
}

/**
 * Rol → izin demetleri.
 *
 * **Yalnız MOCK modu içindir.** Canlı modda izinler `GET /me` ile sunucudan gelir ve
 * tek doğruluk kaynağı odur.
 *
 * Buranın ÜRETİLMİŞ olması bir hata sınıfını kapatıyor: iOS aynı listeyi elle tutuyordu
 * ve Faz 6'nın finans izinleri hiç eklenmediği için mock modda kasa, prim ve cari hesap
 * ekranlarına ulaşılamıyordu — testin yakalayamadığı, yalnız elle gezerken görülen bir
 * kayıp. Artık `permissions.ts` değiştiğinde bu dosya da değişir ve CI bayat kalmasına
 * izin vermez.
 */
object RolePermissions {
    private val byRole: Map<String, List<String>> =
        mapOf(
            "platform_admin" to
                listOf(

                ),
            "owner" to
                listOf(
                    "tenant:read",
                    "tenant:write",
                    "branch:read",
                    "branch:write",
                    "user:read",
                    "user:write",
                    "user:invite",
                    "appointment:read.all",
                    "appointment:write",
                    "appointment:reopen",
                    "service:read",
                    "service:write",
                    "staff:read",
                    "staff:write",
                    "schedule:read",
                    "schedule:write",
                    "resource:read",
                    "resource:write",
                    "customer:read",
                    "customer:write",
                    "customer:merge",
                    "customer.medical:read",
                    "customer.medical:write",
                    "package:read",
                    "package:write",
                    "package:refund",
                    "package:transfer",
                    "finance.payment:read",
                    "finance.payment:write",
                    "finance.price:override",
                    "finance.commission:read",
                    "finance.commission:write",
                    "report.revenue:read",
                    "report.performance:read.own",
                    "consent:read",
                    "consent:manage",
                    "notification:send",
                    "notification:read",
                    "notification:manage",
                    "booking_page:read",
                    "booking_page:manage",
                    "audit:read",
                ),
            "manager" to
                listOf(
                    "tenant:read",
                    "branch:read",
                    "user:read",
                    "user:invite",
                    "appointment:read.all",
                    "appointment:write",
                    "customer:read",
                    "customer:write",
                    "service:read",
                    "staff:read",
                    "schedule:read",
                    "package:read",
                    "consent:read",
                    "notification:read",
                    "appointment:reopen",
                    "service:write",
                    "staff:write",
                    "schedule:write",
                    "customer.medical:read",
                    "customer:merge",
                    "package:write",
                    "package:refund",
                    "package:transfer",
                    "finance.payment:read",
                    "finance.payment:write",
                    "finance.price:override",
                    "finance.commission:read",
                    "finance.commission:write",
                    "report.revenue:read",
                    "consent:manage",
                    "notification:send",
                    "notification:manage",
                    "booking_page:read",
                    "booking_page:manage",
                    "audit:read",
                ),
            "accountant" to
                listOf(
                    "tenant:read",
                    "branch:read",
                    "customer:read",
                    "package:read",
                    "package:refund",
                    "finance.payment:read",
                    "finance.payment:write",
                    "finance.commission:read",
                    "report.revenue:read",
                ),
            "receptionist" to
                listOf(
                    "branch:read",
                    "appointment:read.all",
                    "appointment:write",
                    "customer:read",
                    "customer:write",
                    "service:read",
                    "staff:read",
                    "schedule:read",
                    "package:read",
                    "consent:read",
                    "notification:read",
                    "package:write",
                    "finance.payment:read",
                    "finance.payment:write",
                    "consent:manage",
                    "notification:send",
                    "booking_page:read",
                ),
            "practitioner" to
                listOf(
                    "branch:read",
                    "appointment:read.own",
                    "appointment:write",
                    "customer:read",
                    "customer.medical:read",
                    "customer.medical:write",
                    "service:read",
                    "staff:read",
                    "schedule:read",
                    "package:read",
                    "consent:read",
                    "notification:read",
                    "report.performance:read.own",
                ),
        )

    fun forRole(roleKey: String): List<String> = byRole[roleKey].orEmpty()
}
