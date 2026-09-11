package com.klinara.android.services.packages

import com.klinara.android.services.booking.Appointment
import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.booking.MockBookingService
import com.klinara.android.services.catalog.CatalogService
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.PageInfo
import kotlinx.coroutines.delay
import java.time.Instant
import kotlin.random.Random

/**
 * Sunucu olmadan paket ekranlarını sürmek için bellek-içi paket servisi.
 *
 * Gerçek servisin **davranışını** taklit eder, yalnız verisini değil: slug çakışması
 * 409, bayat sürüm `VERSION_CONFLICT`, pasif hizmet kalem olamaz, satılmış tanım
 * arşivlenmez yalnız pasife alınır. Arayüz bu hatalara göre yazılıyor; mock'un onları
 * atlaması, canlıda ilk denemede çıkan bir hataya dönüşürdü (§5.1).
 *
 * Kalem fiyatı ve adı [catalog]'dan okunur — sunucu da `unitListPriceMinor`'ı katalogdan
 * join'liyor ve istemcinin gönderdiği fiyata güvenmiyor.
 *
 * Eşzamanlılık: her metodun tek askıya alma noktası baştaki [settle]; tablolar ondan
 * SONRA askıya alınmadan okunup yazılıyor, yani ana iş parçacığında atomik.
 */
@Suppress("TooManyFunctions")
// Sunucudaki dört controller'ın mock'u tek sınıfta: defter tabloları paylaşılıyor ve
// bölmek, kalan hakkı iki sınıfın ortak durumuna dağıtmak olurdu (§7.7 gevşetmesi).
class MockPackagesService(
    private val catalog: CatalogService = MockCatalogService(latencyEnabled = false),
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
    /** Müşteri tablosu — satış varlığı, devir hedefi ve rapor adları buradan okunur. */
    private val customers: () -> List<Customer> = { MockCustomers.ALL.map { it.toCustomer() } },
    /** Randevu bağlama için. `null` ise (birim testleri) `consume` 404 verir. */
    private val booking: MockBookingService? = null,
    /** Süre dolumu kararı için "şimdi" — testler sabitler. */
    private val now: () -> Instant = Instant::now,
    /**
     * Oturumdaki rolün `report.revenue:read`'i var mı. Sunucu parasal alanları buna göre
     * `null`'lar ve yükümlülük raporunu 403 ile kapatır; mock da aynısını yapmazsa
     * "tutar gizleme" dalı hiç sürülemez.
     */
    private val canReadRevenue: () -> Boolean = { true },
) : PackagesService,
    MockBookingService.PackageConsumptionHook {
    var failing: Boolean = false

    private val definitionRecords: MutableList<PackageDefinition> = MockPackagesSeed.definitions().toMutableList()

    /** Paket ve defter tabloları + TEK yazma noktası — [MockPackageLedger]. */
    private val ledger = MockPackageLedger(now)

    /** `Idempotency-Key` → üretilen kaydın kimliği (satış/devir) ya da tüketim sonucu. */
    private val idempotentPackages: MutableMap<String, String> = mutableMapOf()
    private val idempotentConsumes: MutableMap<String, ConsumePackageResult> = mutableMapOf()
    private val idempotentRefunds: MutableMap<String, RefundResult> = mutableMapOf()

    private var idCounter: Int = 0

    // --- Tanımlar ---

    override suspend fun definitions(query: PackageDefinitionQuery): Page<PackageDefinition> {
        settle()
        val rows =
            definitionRecords
                .asSequence()
                .filter { it.deletedAt == null }
                // Kapsam sorusu: şubeye özel VE tüm şubelerde geçerli tanımlar birlikte.
                .filter { query.branchId == null || it.branchId == null || it.branchId == query.branchId }
                .filter { query.serviceId == null || it.items.any { item -> item.serviceId == query.serviceId } }
                .filter { query.isActive == null || it.isActive == query.isActive }
                .sortedByDescending { it.createdAt }
                .toList()
        return Page(rows, PageInfo(nextCursor = null, hasMore = false))
    }

    override suspend fun definition(id: String): PackageDefinition {
        settle()
        return definitionRecords.firstOrNull { it.id == id } ?: throw MockErrors.notFound("Paket tanımı")
    }

    override suspend fun createDefinition(input: CreatePackageDefinitionInput): PackageDefinition {
        val services = catalog.services()
        settle()
        if (definitionRecords.any { it.slug == input.slug && it.deletedAt == null }) {
            throw MockErrors.conflict("Bu kod zaten kullanılıyor", "Başka bir paket aynı slug'ı taşıyor.")
        }
        validate(input.totalPriceMinor, input.validityDays, input.items)
        val items = resolveItems(input.items, services)
        val stamp = ledger.nextInstant()
        val created =
            PackageDefinition(
                id = nextId(),
                branchId = input.branchId,
                slug = input.slug,
                name = input.name,
                description = input.description,
                totalPriceMinor = input.totalPriceMinor,
                listPriceMinor = items.sumOf { it.listTotalMinor },
                validityDays = input.validityDays,
                isTransferable = input.isTransferable ?: true,
                isOnlineSellable = input.isOnlineSellable ?: false,
                isActive = input.isActive ?: true,
                items = items,
                createdAt = stamp,
                updatedAt = stamp,
            )
        definitionRecords.add(created)
        return created
    }

    override suspend fun updateDefinition(
        id: String,
        version: Int,
        input: UpdatePackageDefinitionInput,
    ): PackageDefinition {
        val services = catalog.services()
        settle()
        val index = definitionRecords.indexOfFirst { it.id == id }
        if (index < 0) throw MockErrors.notFound("Paket tanımı")
        val old = definitionRecords[index]
        if (old.version != version) throw MockErrors.versionConflict()

        val validity = input.validityDays.resolve(old.validityDays)
        validate(input.totalPriceMinor ?: old.totalPriceMinor, validity, input.items)
        val items = input.items?.let { resolveItems(it, services) } ?: old.items

        val updated =
            old.copy(
                name = input.name ?: old.name,
                description = input.description.resolve(old.description),
                totalPriceMinor = input.totalPriceMinor ?: old.totalPriceMinor,
                listPriceMinor = items.sumOf { it.listTotalMinor },
                validityDays = validity,
                isTransferable = input.isTransferable ?: old.isTransferable,
                isOnlineSellable = input.isOnlineSellable ?: old.isOnlineSellable,
                isActive = input.isActive ?: old.isActive,
                // Satışı etkileyen alan değiştiyse revizyon artar; satılmış paketler bundan
                // ETKİLENMEZ, snapshot'larıyla yaşarlar.
                revision = if (input.affectsSale) old.revision + 1 else old.revision,
                version = old.version + 1,
                items = items,
                updatedAt = ledger.nextInstant(),
            )
        definitionRecords[index] = updated
        return updated
    }

    override suspend fun retireDefinition(
        id: String,
        version: Int,
    ) {
        settle()
        val index = definitionRecords.indexOfFirst { it.id == id }
        if (index < 0) throw MockErrors.notFound("Paket tanımı")
        val old = definitionRecords[index]
        if (old.version != version) throw MockErrors.versionConflict()
        val stamp = ledger.nextInstant()
        // Satılmışsa arşivlenmez, yalnız pasife alınır — satış izi kopmasın.
        definitionRecords[index] =
            old.copy(
                isActive = false,
                version = old.version + 1,
                updatedAt = stamp,
                deletedAt = if (isSold(id)) null else stamp,
            )
    }

    // --- Satış ve defter ---

    override suspend fun sell(
        input: CreateCustomerPackageInput,
        idempotencyKey: String,
    ): CustomerPackage {
        settle()
        // Aynı anahtar = aynı satış. Tekrarı İKİNCİ bir paket üretmez, ilkini döndürür.
        idempotentPackages[idempotencyKey]?.let { id -> return ledger.packages.first { it.id == id } }

        val definition =
            definitionRecords.firstOrNull { it.id == input.definitionId && it.isActive && !it.isArchived }
                ?: throw MockErrors.validation("definitionId", "Paket tanımı satışa kapalı.")
        if (customers().none { it.id == input.customerId }) {
            throw MockErrors.validation("customerId", "Müşteri bulunamadı.")
        }

        val soldAt = now()
        val allocations =
            MockPackagesSeed.allocate(definition.totalPriceMinor, definition.sortedItems.map { it.listTotalMinor })
        val items =
            definition.sortedItems.mapIndexed { index, item ->
                CustomerPackageItem(
                    id = nextId(),
                    serviceId = item.serviceId,
                    serviceName = item.serviceName,
                    quantityTotal = item.quantity,
                    unitListPriceMinor = item.unitListPriceMinor,
                    itemTotalMinor = allocations[index],
                    sortOrder = item.sortOrder,
                )
            }
        val sold =
            CustomerPackage(
                id = nextId(),
                customerId = input.customerId,
                // Mock `X-Branch-Id`'yi görmüyor: şubeye özel tanım kendi şubesinde, genel
                // tanım varsayılan şubede satılır.
                branchId = definition.branchId ?: MockIds.BRANCH_NISANTASI,
                definitionId = definition.id,
                name = definition.name,
                definitionRevision = definition.revision,
                totalPriceMinor = definition.totalPriceMinor,
                currency = definition.currency,
                isTransferable = definition.isTransferable,
                validityDays = definition.validityDays,
                soldAt = soldAt,
                expiresAt = definition.validityDays?.let { soldAt.plusSeconds(it * MockPackagesSeed.DAY_SECONDS) },
                note = input.note,
                items = items,
                createdAt = soldAt,
            )
        ledger.add(sold)
        items.forEach { item ->
            ledger.append(sold.id, ledger.entry(sold, item.id, LedgerEntryType.Purchase, item.quantityTotal))
        }
        idempotentPackages[idempotencyKey] = sold.id
        return ledger.current(sold.id)
    }

    override suspend fun packages(
        customerId: String,
        query: CustomerPackageQuery,
    ): Page<CustomerPackage> {
        settle()
        val rows =
            ledger.packages
                .filter { it.customerId == customerId }
                .filter { query.status == null || it.status == query.status }
                .sortedByDescending { it.soldAt }
        return Page(rows, PageInfo(nextCursor = null, hasMore = false))
    }

    override suspend fun customerPackage(id: String): CustomerPackage {
        settle()
        return ledger.current(id)
    }

    override suspend fun ledger(
        packageId: String,
        cursor: String?,
        limit: Int?,
    ): Page<PackageLedgerEntry> {
        settle()
        ledger.current(packageId)
        return Page(ledger.entries(packageId).toList(), PageInfo(nextCursor = null, hasMore = false))
    }

    override suspend fun entitlements(
        customerId: String,
        serviceId: String?,
        branchId: String?,
    ): List<PackageEntitlement> {
        settle()
        val instant = now()
        return ledger.packages
            .filter { it.customerId == customerId && it.isConsumable(instant) }
            .filter { branchId == null || it.branchId == branchId }
            .flatMap { pkg ->
                pkg.sortedItems
                    .filter { it.remainingSessions > 0 && (serviceId == null || it.serviceId == serviceId) }
                    .map { item ->
                        PackageEntitlement(
                            customerPackageItemId = item.id,
                            customerPackageId = pkg.id,
                            packageName = pkg.name,
                            serviceId = item.serviceId,
                            serviceName = item.serviceName,
                            remainingSessions = item.remainingSessions,
                            expiresAt = pkg.expiresAt,
                            branchId = pkg.branchId,
                        )
                    }
            }
    }

    override suspend fun consume(
        appointmentId: String,
        input: ConsumePackageInput,
        idempotencyKey: String,
    ): ConsumePackageResult {
        settle()
        idempotentConsumes[idempotencyKey]?.let { return it }
        val bookingMock = booking ?: throw MockErrors.notFound("Randevu")
        val appointment = bookingMock.current(appointmentId)

        // Önce HEPSİ doğrulanır, sonra yazılır: yarısı bağlanmış bir randevu olmasın.
        input.lines.forEach { line ->
            val serviceLine =
                appointment.services.firstOrNull { it.id == line.appointmentServiceId }
                    ?: throw MockErrors.notFound("Randevu kalemi")
            val (pkg, item) = ledger.locate(line.customerPackageItemId)
            if (pkg.customerId != appointment.customerId) throw MockErrors.forbidden("Paket bu müşteriye ait değil.")
            if (item.serviceId != serviceLine.serviceId) {
                throw MockErrors.validation("lines", "Paket kalemi bu hizmet için kullanılamaz.")
            }
            if (!pkg.isConsumable(now())) throw MockErrors.packageExpired()
            if (item.remainingSessions < 1) throw MockErrors.packageExhausted()
        }

        var consumed = 0
        input.lines.forEach { line ->
            // Bağlama her durumda; DÜŞME yalnız randevu zaten `completed` ise. Sunucudaki
            // kural bu ve mock'un ayrışması arayüzü canlıda ilk denemede yanıltırdı.
            val bound =
                bookingMock.bindPackageItem(appointmentId, line.appointmentServiceId, line.customerPackageItemId)
            if (bound.status == AppointmentStatus.Completed) {
                ledger.apply(line.customerPackageItemId, LedgerEntryType.Consume, -1, appointmentId = appointmentId)
                consumed += 1
            }
        }
        return ConsumePackageResult(bound = input.lines.size, consumed = consumed).also {
            idempotentConsumes[idempotencyKey] = it
        }
    }

    // --- Operasyonlar ---

    override suspend fun adjust(
        id: String,
        version: Int,
        input: AdjustPackageInput,
    ): CustomerPackage {
        settle()
        val pkg = lockedOpen(id, version)
        if (!OperationReason.isValid(input.reason)) {
            throw MockErrors.validation("reason", "Gerekçe en az ${OperationReason.MIN_LENGTH} karakter olmalı.")
        }
        if (input.items.isEmpty() || input.items.any { it.delta == 0 }) {
            throw MockErrors.validation("items", "Düzeltme sıfır olamaz.")
        }
        // Önce hepsi doğrulanır: ikinci kalem yetersizse birinci de yazılmamalı.
        input.items.forEach { item ->
            val current = ledger.itemOf(pkg, item.customerPackageItemId)
            if (current.remainingSessions + item.delta < 0) throw MockErrors.packageExhausted()
        }
        input.items.forEach {
            val reason = input.reason.trim()
            ledger.apply(it.customerPackageItemId, LedgerEntryType.ManualAdjustment, it.delta, reason = reason)
        }
        return ledger.bump(id)
    }

    override suspend fun refund(
        id: String,
        version: Int,
        input: RefundPackageInput,
        idempotencyKey: String,
    ): RefundResult {
        settle()
        idempotentRefunds[idempotencyKey]?.let { return it }
        val pkg = lockedOpen(id, version)
        if (!OperationReason.isValid(input.reason)) throw MockErrors.validation("reason", "İade gerekçesi zorunlu.")
        val lines = resolveLines(pkg, input.items)
        if (lines.isEmpty()) throw MockErrors.conflict("İade edilecek kalan hak yok")

        // Tutar SATIŞ ANINDAKİ tahsisten — güncel katalog fiyatından DEĞİL.
        val amount = lines.sumOf { (item, sessions) -> item.unitAllocationMinor * sessions }
        lines.forEach { (item, sessions) ->
            ledger.apply(item.id, LedgerEntryType.Refund, -sessions, reason = input.reason.trim())
        }
        val refunded = lines.sumOf { it.second }
        ledger.update(id) { current ->
            current.copy(
                status = if (current.remainingSessions == 0) CustomerPackageStatus.Refunded else current.status,
                refundedSessions = current.refundedSessions + refunded,
                refundAmountMinor = current.refundAmountMinor + amount,
                // Kasa hareketi YOK: borç doğar, tahsilat Faz A6'da bağlanır.
                refundSettlementStatus = "pending",
                refundedAt = ledger.nextInstant(),
                refundReason = input.reason.trim(),
                version = current.version + 1,
            )
        }
        return RefundResult(refunded, amount, "pending").also { idempotentRefunds[idempotencyKey] = it }
    }

    override suspend fun transfer(
        id: String,
        version: Int,
        input: TransferPackageInput,
        idempotencyKey: String,
    ): CustomerPackage {
        settle()
        idempotentPackages[idempotencyKey]?.let { return ledger.current(it) }
        val source = lockedOpen(id, version)
        if (!source.isTransferable) {
            throw MockErrors.conflict("Bu paket devredilemez", "Paket devredilemez olarak satıldı.")
        }
        if (source.customerId == input.targetCustomerId) {
            throw MockErrors.validation("targetCustomerId", "Paket aynı müşteriye devredilemez.")
        }
        if (customers().none { it.id == input.targetCustomerId }) {
            throw MockErrors.validation("targetCustomerId", "Hedef müşteri bulunamadı.")
        }
        if (!OperationReason.isValid(input.reason)) throw MockErrors.validation("reason", "Devir gerekçesi zorunlu.")
        val lines = resolveLines(source, input.items)
        if (lines.isEmpty()) throw MockErrors.conflict("Devredilecek kalan hak yok")

        val stamp = ledger.nextInstant()
        val targetItems =
            lines.mapIndexed { position, (item, sessions) ->
                CustomerPackageItem(
                    id = nextId(),
                    serviceId = item.serviceId,
                    serviceName = item.serviceName,
                    quantityTotal = sessions,
                    unitListPriceMinor = item.unitListPriceMinor,
                    // Devredilen hakkın karşılığı KAYNAĞIN tahsisinden taşınır.
                    itemTotalMinor = item.unitAllocationMinor * sessions,
                    sortOrder = position,
                )
            }
        val target =
            source.copy(
                id = nextId(),
                customerId = input.targetCustomerId,
                totalPriceMinor = targetItems.sumOf { it.itemTotalMinor },
                soldAt = stamp,
                // Aynı geçerlilik SONU: devir süreyi uzatmaz.
                expiresAt = source.expiresAt,
                status = CustomerPackageStatus.Active,
                refundedSessions = 0,
                refundAmountMinor = 0,
                refundSettlementStatus = null,
                refundedAt = null,
                refundReason = null,
                transferredFromPackageId = source.id,
                note = null,
                version = 1,
                items = targetItems,
                createdAt = stamp,
            )
        ledger.add(target)
        lines.forEach { (item, sessions) ->
            ledger.apply(item.id, LedgerEntryType.TransferOut, -sessions, reason = input.reason.trim())
        }
        targetItems.forEach { item ->
            val reason = input.reason.trim()
            val entry = ledger.entry(target, item.id, LedgerEntryType.TransferIn, item.quantityTotal, reason)
            ledger.append(target.id, entry)
        }
        ledger.update(source.id) { current ->
            current.copy(
                status = if (current.remainingSessions == 0) CustomerPackageStatus.Transferred else current.status,
                version = current.version + 1,
            )
        }
        idempotentPackages[idempotencyKey] = target.id
        return ledger.current(target.id)
    }

    /** İyimser kilit + açık paket: bayat sürüm 409 `VERSION_CONFLICT`, kapalı paket `PACKAGE_EXPIRED`. */
    private fun lockedOpen(
        id: String,
        version: Int,
    ): CustomerPackage {
        val pkg = ledger.current(id)
        if (pkg.version != version) throw MockErrors.versionConflict()
        if (!pkg.status.isOpen) throw MockErrors.packageExpired()
        return pkg
    }

    /**
     * İade/devir satırlarını çözer. `null` = tüm kalan hak. Kalanı aşan satır `PACKAGE_EXHAUSTED`
     * — ve bu kontrol HİÇBİR satır yazılmadan önce yapılır.
     */
    private fun resolveLines(
        pkg: CustomerPackage,
        items: List<SessionsItemInput>?,
    ): List<Pair<CustomerPackageItem, Int>> {
        val lines =
            items?.map { ledger.itemOf(pkg, it.customerPackageItemId) to it.sessions }
                ?: pkg.sortedItems.filter { it.remainingSessions > 0 }.map { it to it.remainingSessions }
        lines.forEach { (item, sessions) ->
            if (sessions < 1) throw MockErrors.validation("items", "Seans sayısı en az 1 olmalı.")
            if (sessions > item.remainingSessions) throw MockErrors.packageExhausted()
        }
        return lines
    }

    // --- Raporlar ---
    //
    // Hesap `MockPackageReports`'ta: sunucuda da raporlar ayrı bir modülde
    // (`modules/reporting`) ve defter tablolarını yalnız OKUYOR. Burada kalan iş izin
    // kapısı ve tabloların okunur kopyasını vermek.

    override suspend fun outstandingReport(
        branchId: String?,
        groupBy: OutstandingGrouping,
    ): OutstandingReport {
        settle()
        if (!canReadRevenue()) throw MockErrors.forbidden("Parasal raporlar bu rolde görüntülenemez.")
        return reports().outstanding(branchId, groupBy)
    }

    override suspend fun expiringReport(
        period: ReportPeriod,
        branchId: String?,
        cursor: String?,
        limit: Int?,
    ): ExpiringReport {
        settle()
        return reports().expiring(period, branchId, cursor, limit, canReadRevenue())
    }

    override suspend fun usageReport(
        period: ReportPeriod,
        branchId: String?,
        groupBy: UsageGrouping,
    ): UsageReport {
        settle()
        return reports().usage(period, branchId, groupBy)
    }

    private fun reports() =
        MockPackageReports(
            packages = ledger.packages.toList(),
            ledger = ledger.snapshot(),
            customerNames = customers().associate { it.id to it.fullName },
        )

    // --- Randevu kancası (MockBookingService.PackageConsumptionHook) ---

    override fun onCompleted(appointment: Appointment) {
        val lines = appointment.services.mapNotNull { it.customerPackageItemId }
        // Önce kontrol, sonra yazma: iki kalemden biri yetersizse hiçbiri düşmez.
        lines.forEach { itemId ->
            val (pkg, item) = ledger.locate(itemId)
            if (!pkg.isConsumable(now())) throw MockErrors.packageExpired()
            if (item.remainingSessions < 1) throw MockErrors.packageExhausted()
        }
        lines.forEach { ledger.apply(it, LedgerEntryType.Consume, -1, appointmentId = appointment.id) }
    }

    override fun onReopened(appointment: Appointment) {
        // Yeniden açma satırı SİLMEZ: tüketimi geri alan bir ters kayıt ekler.
        ledger.packages.map { it.id }.forEach { packageId ->
            val entries = ledger.entries(packageId)
            val reversed = entries.mapNotNull { it.reversesEntryId }.toSet()
            entries
                .filter { it.appointmentId == appointment.id && it.entryType == LedgerEntryType.Consume }
                .filter { it.delta < 0 && it.id !in reversed }
                .forEach { original ->
                    ledger.apply(
                        original.customerPackageItemId,
                        LedgerEntryType.Consume,
                        -original.delta,
                        reason = "Randevu yeniden açıldı",
                        appointmentId = appointment.id,
                        reversesEntryId = original.id,
                    )
                }
        }
    }

    // --- Yardımcılar ---

    private fun isSold(definitionId: String): Boolean = ledger.packages.any { it.definitionId == definitionId }

    /**
     * Sunucudaki DTO doğrulamasının aynası — yol adları `FieldError.path` ile birebir.
     * İlk ihlali döndürür; çağıran fırlatır (tek `throw`, dört kural).
     */
    private fun validate(
        totalPriceMinor: Long,
        validityDays: Int?,
        items: List<PackageDefinitionItemInput>?,
    ) {
        val violation =
            when {
                totalPriceMinor < 0 -> "totalPriceMinor" to "Fiyat negatif olamaz."
                validityDays != null && validityDays < 1 ->
                    "validityDays" to "Geçerlilik en az 1 gün olmalı; süresiz için boş bırakın."
                items == null -> null
                items.isEmpty() -> "items" to "En az bir kalem gerekli."
                items.any { it.quantity < 1 } -> "items" to "Adet en az 1 olmalı."
                items.map { it.serviceId }.toSet().size != items.size -> "items" to "Aynı hizmet iki kez eklenemez."
                else -> null
            }
        violation?.let { (path, message) -> throw MockErrors.validation(path, message) }
    }

    private fun resolveItems(
        inputs: List<PackageDefinitionItemInput>,
        services: List<ClinicService>,
    ): List<PackageDefinitionItem> =
        inputs.mapIndexed { position, input ->
            val service =
                services.firstOrNull { it.id == input.serviceId }
                    ?: throw MockErrors.validation("items", "Hizmet bulunamadı.")
            if (!service.isActive) throw MockErrors.validation("items", "Pasif hizmet pakete eklenemez.")
            PackageDefinitionItem(
                id = nextId(),
                serviceId = service.id,
                serviceName = service.name,
                quantity = input.quantity,
                unitListPriceMinor = service.priceMinor,
                sortOrder = position,
            )
        }

    private fun <T> Patch<T>.resolve(old: T?): T? =
        when (this) {
            Patch.Unchanged -> old
            Patch.Clear -> null
            is Patch.Set -> value
        }

    private fun nextId(): String = "f9000000-0000-4000-8000-%012d".format(++idCounter)

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    private companion object {
        const val MIN_LATENCY_MILLIS = 120L
        const val MAX_LATENCY_MILLIS = 400L
    }
}
