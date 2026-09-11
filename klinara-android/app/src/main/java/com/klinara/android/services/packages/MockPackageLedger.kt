package com.klinara.android.services.packages

import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.mock.MockIds
import java.time.Instant

/**
 * Paket mock'unun tabloları ve **tek yazma noktası** ([apply] / [append]).
 *
 * Sunucuda kalan hak `apply_package_ledger_entry()` trigger'ında korunuyor; burada da
 * bu sınıfta ve yalnız burada. [MockPackagesService] uç kurallarını (izin, sürüm,
 * idempotency, doğrulama) uyguluyor, defteri bu sınıfa yazdırıyor. Bölünme detekt'in
 * büyük sınıf eşiğinden doğdu ama keyfi değil: "ucun kuralı" ile "defterin kuralı" iki
 * ayrı şey ve sunucu da onları iki katmanda tutuyor.
 *
 * Tablolar append-only: [entries] satırı değiştirilmez ya da silinmez; düzeltme ters kayıttır.
 */
internal class MockPackageLedger(
    private val now: () -> Instant,
) {
    private val records: MutableList<CustomerPackage> = mutableListOf()

    /** `customerPackageId` → defter satırları, **yeniden eskiye**. */
    private val entries: MutableMap<String, MutableList<PackageLedgerEntry>> = mutableMapOf()

    private var entryCounter: Int = 0

    /** [nextInstant]'ın son değeri — `init`'ten ÖNCE tanımlı: başlatıcılar metin sırasıyla koşar. */
    private var lastInstant: Instant = Instant.EPOCH

    init {
        seed()
    }

    /** Okunur görünüm — yazma yalnız bu sınıfın metotlarından. */
    val packages: List<CustomerPackage> get() = records

    fun add(pkg: CustomerPackage) {
        records += pkg
    }

    fun entries(packageId: String): List<PackageLedgerEntry> = entries[packageId].orEmpty().toList()

    fun snapshot(): Map<String, List<PackageLedgerEntry>> = entries.mapValues { it.value.toList() }

    /**
     * Seed paketleri satış anındaki hâlleriyle eklenir ve defter satırları TEK YAZMA
     * NOKTASINDAN ([append]) geçirilir — kalan hak defterden doğar, seed'den değil.
     */
    fun seed() {
        MockPackagesSeed.SOLD_PACKAGES.forEach { spec ->
            val sold = MockPackagesSeed.soldPackageAtSale(spec)
            val seedDay = MockPackagesSeed.DAY_SECONDS
            records += sold
            val written = mutableListOf<PackageLedgerEntry>()
            spec.ledger.forEach { seed ->
                val entry =
                    entry(
                        pkg = sold,
                        itemId = seed.itemId,
                        type = seed.type,
                        delta = seed.delta,
                        reason = seed.reason,
                        reversesEntryId = seed.reversesIndex?.let { written[it].id },
                        createdAt = MockPackagesSeed.SEED_NOW.minusSeconds(seed.daysAgo * seedDay),
                        appointmentId =
                            "${sold.id}-seed-${written.size}".takeIf { seed.type == LedgerEntryType.Consume },
                    )
                written += entry
                append(sold.id, entry)
            }
        }
    }

    // --- Defter uygulaması ---

    /**
     * TEK yazma noktası — sunucudaki `apply_package_ledger_entry()` trigger'ının aynası.
     * **Hak kontrolü yazmadan ÖNCE** yapılır ve kendi hatasını döner; kalan hak asla
     * eksiye inmez.
     */
    @Suppress("LongParameterList")
    fun apply(
        itemId: String,
        type: LedgerEntryType,
        delta: Int,
        reason: String? = null,
        appointmentId: String? = null,
        reversesEntryId: String? = null,
    ) {
        val (pkg, item) = locate(itemId)
        if (delta < 0 && !pkg.isConsumable(now())) throw MockErrors.packageExpired()
        if (item.remainingSessions + delta < 0) throw MockErrors.packageExhausted()
        append(pkg.id, entry(pkg, itemId, type, delta, reason, appointmentId, reversesEntryId))
    }

    /**
     * Satırı deftere ekler ve paketin yansımalarını (kalem kalanı, karşılık, toplam)
     * DEFTERDEN yeniden hesaplar. Kalan hak bir sayaç olarak artırılıp azaltılmıyor —
     * satırların toplamı.
     */
    fun append(
        packageId: String,
        entry: PackageLedgerEntry,
    ) {
        val entries = entries.getOrPut(packageId) { mutableListOf() }
        entries.add(0, entry)
        val index = records.indexOfFirst { it.id == packageId }
        val pkg = records[index]
        val items =
            pkg.items.map { item ->
                val remaining = entries.filter { it.customerPackageItemId == item.id }.sumOf { it.delta }
                item.copy(remainingSessions = remaining, outstandingMinor = item.unitAllocationMinor * remaining)
            }
        records[index] =
            pkg.copy(
                items = items,
                remainingSessions = items.sumOf { it.remainingSessions },
                outstandingMinor = items.sumOf { it.outstandingMinor },
            )
    }

    @Suppress("LongParameterList")
    fun entry(
        pkg: CustomerPackage,
        itemId: String,
        type: LedgerEntryType,
        delta: Int,
        reason: String? = null,
        appointmentId: String? = null,
        reversesEntryId: String? = null,
        createdAt: Instant = nextInstant(),
    ): PackageLedgerEntry {
        val item = pkg.items.first { it.id == itemId }
        return PackageLedgerEntry(
            id = "f5000000-0000-4000-8000-%012d".format(++entryCounter),
            customerPackageItemId = itemId,
            serviceId = item.serviceId,
            serviceName = item.serviceName,
            entryType = type,
            delta = delta,
            appointmentId = appointmentId,
            actorUserId = MockIds.USER_MANAGER,
            reason = reason,
            reversesEntryId = reversesEntryId,
            createdAt = createdAt,
        )
    }

    fun current(packageId: String): CustomerPackage =
        records.firstOrNull { it.id == packageId } ?: throw MockErrors.notFound("Paket")

    fun locate(itemId: String): Pair<CustomerPackage, CustomerPackageItem> {
        val pkg =
            records.firstOrNull { pkg -> pkg.items.any { it.id == itemId } }
                ?: throw MockErrors.notFound("Paket kalemi")
        return pkg to pkg.items.first { it.id == itemId }
    }

    fun itemOf(
        pkg: CustomerPackage,
        itemId: String,
    ): CustomerPackageItem = pkg.items.firstOrNull { it.id == itemId } ?: throw MockErrors.notFound("Paket kalemi")

    fun bump(id: String): CustomerPackage = update(id) { it.copy(version = it.version + 1) }

    fun update(
        id: String,
        transform: (CustomerPackage) -> CustomerPackage,
    ): CustomerPackage {
        val index = records.indexOfFirst { it.id == id }
        records[index] = transform(records[index])
        return records[index]
    }

    /**
     * Monotonik "şimdi": aynı milisaniyede yazılan iki defter satırı eşit zaman almasın ve
     * defter sırası deterministik kalsın.
     */
    fun nextInstant(): Instant {
        lastInstant = maxOf(now(), lastInstant.plusMillis(1))
        return lastInstant
    }
}
