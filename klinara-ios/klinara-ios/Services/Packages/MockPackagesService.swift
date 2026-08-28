import Foundation

/// Sunucu olmadan paket ekranlarını sürmek için bellek-içi paket defteri.
///
/// Gerçek servisin **davranışını** taklit eder, yalnız verisini değil ve en
/// önemlisi defteri: kalan hak burada da bir sayaç değil, satırların
/// toplamıdır. Hak yetersizken tüketim ``APIErrorCode/packageExhausted``
/// fırlatır, süresi dolmuş paket ``APIErrorCode/packageExpired``, bayat sürüm
/// `VERSION_CONFLICT`. Arayüz bu hatalara göre yazıldığı için mock'un onları
/// atlaması, canlıda ilk denemede çıkan hataya dönüşürdü.
final class MockPackagesService: PackagesService, @unchecked Sendable {

    private let lock = NSLock()
    private let catalog: MockCatalogService
    private let customers: MockCustomerService
    private let booking: MockBookingService

    private var definitionRecords: [PackageDefinition] = []
    private var packageRecords: [CustomerPackage] = []
    /// `customerPackageId` → defter satırları, **yeniden eskiye**.
    private var ledgerEntries: [String: [PackageLedgerEntry]] = [:]
    /// `Idempotency-Key` → üretilen paket kimliği.
    private var idempotency: [String: String] = [:]

    init(
        catalog: MockCatalogService,
        customers: MockCustomerService,
        booking: MockBookingService
    ) {
        self.catalog = catalog
        self.customers = customers
        self.booking = booking
        seed()
    }

    /// Geliştirici menüsünden senaryo değiştirildiğinde çağrılır.
    func reseed() {
        withLock { seed() }
    }

    private func seed() {
        let now = Date()
        definitionRecords = MockPackagesSeed.definitions(at: now)
        let sold = MockPackagesSeed.soldPackage(at: now)
        packageRecords = [sold]
        ledgerEntries = [sold.id: MockPackagesSeed.ledger(for: sold, at: now)]
        idempotency = [:]
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func latency(_ seconds: Double = 0.4) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    // MARK: Hatalar

    private func notFound() -> APIError {
        .problem(ProblemDetails(code: .notFound, title: "Bulunamadı", status: 404))
    }

    private func conflict(_ detail: String) -> APIError {
        .problem(ProblemDetails(code: .conflict, title: "Çakışma", detail: detail, status: 409))
    }

    private func versionConflict() -> APIError {
        .problem(ProblemDetails(
            code: .versionConflict,
            title: "Sürüm çakışması",
            detail: "Kayıt siz düzenlerken değişti",
            status: 409
        ))
    }

    private func exhausted() -> APIError {
        .problem(ProblemDetails(
            code: .packageExhausted,
            title: "Paket hakkı yetersiz",
            detail: "Kalan hak bu işlem için yeterli değil",
            status: 409
        ))
    }

    private func expired() -> APIError {
        .problem(ProblemDetails(
            code: .packageExpired,
            title: "Paket kullanılamaz",
            detail: "Paket süresi dolmuş ya da kapatılmış",
            status: 409
        ))
    }

    private func validation(_ detail: String) -> APIError {
        .problem(ProblemDetails(
            code: .validationFailed,
            title: "Geçersiz istek",
            detail: detail,
            status: 422
        ))
    }

    // MARK: Tanımlar

    func definitions(
        cursor: String?,
        limit: Int?,
        branchId: String?,
        serviceId: String?,
        isActive: Bool?
    ) async throws -> Page<PackageDefinition> {
        await latency(0.3)
        return withLock {
            let filtered = definitionRecords
                .filter { $0.deletedAt == nil }
                // `branchId` filtresi şubeye özel VE tüm şubelerde geçerli
                // paketleri birlikte döner; sunucu da öyle yapıyor.
                .filter { branchId == nil || $0.branchId == nil || $0.branchId == branchId }
                .filter { serviceId == nil || $0.items.contains { $0.serviceId == serviceId } }
                .filter { isActive == nil || $0.isActive == isActive }
                .sorted { $0.createdAt > $1.createdAt }
            return Page(data: filtered, pageInfo: PageInfo(nextCursor: nil, hasMore: false))
        }
    }

    func definition(id: String) async throws -> PackageDefinition {
        await latency(0.2)
        return try withLock {
            guard let found = definitionRecords.first(where: { $0.id == id }) else { throw notFound() }
            return found
        }
    }

    func createDefinition(_ input: CreatePackageDefinitionInput) async throws -> PackageDefinition {
        await latency()
        return try withLock {
            guard !definitionRecords.contains(where: { $0.slug == input.slug && $0.deletedAt == nil }) else {
                throw conflict("Bu slug zaten kullanılıyor")
            }
            let services = catalog.snapshotServices
            let items = try input.items.enumerated().map { index, item -> PackageDefinitionItem in
                guard let service = services.first(where: { $0.id == item.serviceId }) else {
                    throw validation("Hizmet bulunamadı")
                }
                guard service.isActive else { throw validation("Pasif hizmet pakete eklenemez") }
                return PackageDefinitionItem(
                    id: MockIDs.uuid(),
                    serviceId: service.id,
                    serviceName: service.name,
                    quantity: item.quantity,
                    unitListPriceMinor: service.priceMinor,
                    sortOrder: index
                )
            }
            let now = Date()
            let created = PackageDefinition(
                id: MockIDs.uuid(),
                branchId: input.branchId,
                slug: input.slug,
                name: input.name,
                description: input.description,
                totalPriceMinor: input.totalPriceMinor,
                listPriceMinor: items.reduce(0) { $0 + $1.listTotalMinor },
                currency: "TRY",
                validityDays: input.validityDays,
                isTransferable: input.isTransferable ?? true,
                isOnlineSellable: input.isOnlineSellable ?? false,
                isActive: input.isActive ?? true,
                revision: 1,
                version: 1,
                items: items,
                createdAt: now,
                updatedAt: now,
                deletedAt: nil
            )
            definitionRecords.append(created)
            return created
        }
    }

    func updateDefinition(
        id: String,
        version: Int,
        _ input: UpdatePackageDefinitionInput
    ) async throws -> PackageDefinition {
        await latency()
        return try withLock {
            guard let index = definitionRecords.firstIndex(where: { $0.id == id }) else { throw notFound() }
            let old = definitionRecords[index]
            guard old.version == version else { throw versionConflict() }

            var items = old.items
            if let replacement = input.items {
                let services = catalog.snapshotServices
                items = try replacement.enumerated().map { position, item in
                    guard let service = services.first(where: { $0.id == item.serviceId }) else {
                        throw validation("Hizmet bulunamadı")
                    }
                    return PackageDefinitionItem(
                        id: MockIDs.uuid(),
                        serviceId: service.id,
                        serviceName: service.name,
                        quantity: item.quantity,
                        unitListPriceMinor: service.priceMinor,
                        sortOrder: position
                    )
                }
            }

            let description: String?
            switch input.description {
            case .unchanged: description = old.description
            case .clear: description = nil
            case .set(let value): description = value
            }

            let validityDays: Int?
            switch input.validityDays {
            case .unchanged: validityDays = old.validityDays
            case .clear: validityDays = nil
            case .set(let value): validityDays = value
            }

            // Satışı etkileyen alan değiştiyse revizyon artar; satılmış
            // paketler bundan ETKİLENMEZ, snapshot'larıyla yaşarlar.
            let affectsSale = input.totalPriceMinor != nil || input.items != nil
                || !input.validityDays.isUnchanged || input.isTransferable != nil

            let updated = PackageDefinition(
                id: old.id,
                branchId: old.branchId,
                slug: old.slug,
                name: input.name ?? old.name,
                description: description,
                totalPriceMinor: input.totalPriceMinor ?? old.totalPriceMinor,
                listPriceMinor: items.reduce(0) { $0 + $1.listTotalMinor },
                currency: old.currency,
                validityDays: validityDays,
                isTransferable: input.isTransferable ?? old.isTransferable,
                isOnlineSellable: input.isOnlineSellable ?? old.isOnlineSellable,
                isActive: input.isActive ?? old.isActive,
                revision: affectsSale ? old.revision + 1 : old.revision,
                version: old.version + 1,
                items: items,
                createdAt: old.createdAt,
                updatedAt: Date(),
                deletedAt: old.deletedAt
            )
            definitionRecords[index] = updated
            return updated
        }
    }

    func retireDefinition(id: String, version: Int) async throws {
        await latency()
        try withLock {
            guard let index = definitionRecords.firstIndex(where: { $0.id == id }) else { throw notFound() }
            let old = definitionRecords[index]
            guard old.version == version else { throw versionConflict() }
            // Satılmışsa arşivlenmez, yalnız pasife alınır — satış izi kopmasın.
            let isSold = packageRecords.contains { $0.definitionId == id }
            definitionRecords[index] = PackageDefinition(
                id: old.id, branchId: old.branchId, slug: old.slug, name: old.name,
                description: old.description, totalPriceMinor: old.totalPriceMinor,
                listPriceMinor: old.listPriceMinor, currency: old.currency,
                validityDays: old.validityDays, isTransferable: old.isTransferable,
                isOnlineSellable: old.isOnlineSellable, isActive: false,
                revision: old.revision, version: old.version + 1, items: old.items,
                createdAt: old.createdAt, updatedAt: Date(),
                deletedAt: isSold ? nil : Date()
            )
        }
    }

    // MARK: Satış ve defter

    func sell(
        _ input: CreateCustomerPackageInput,
        idempotencyKey: String?
    ) async throws -> CustomerPackage {
        await latency(0.6)
        return try withLock {
            if let key = idempotencyKey, let existingId = idempotency[key],
               let existing = packageRecords.first(where: { $0.id == existingId }) {
                return existing
            }
            guard let definition = definitionRecords.first(where: { $0.id == input.definitionId }),
                  definition.deletedAt == nil, definition.isActive
            else { throw validation("Paket tanımı satışa kapalı") }
            guard customers.snapshot.contains(where: { $0.id == input.customerId }) else {
                throw validation("Müşteri bulunamadı")
            }

            let now = Date()
            // Para KALEMDE durur: satış tutarı kalemlerin liste ağırlığına göre
            // largest-remainder ile dağıtılır, kuruş kaybı olmaz.
            let weights = definition.items.map(\.listTotalMinor)
            let allocations = Self.allocate(definition.totalPriceMinor, weights: weights)
            let items = zip(definition.items, allocations).map { item, allocation in
                CustomerPackageItem(
                    id: MockIDs.uuid(),
                    serviceId: item.serviceId,
                    serviceName: item.serviceName,
                    quantityTotal: item.quantity,
                    remainingSessions: item.quantity,
                    unitListPriceMinor: item.unitListPriceMinor,
                    itemTotalMinor: allocation,
                    outstandingMinor: allocation,
                    sortOrder: item.sortOrder
                )
            }
            let sold = CustomerPackage(
                id: MockIDs.uuid(),
                customerId: input.customerId,
                branchId: MockIDs.branchNisantasi,
                definitionId: definition.id,
                name: definition.name,
                definitionRevision: definition.revision,
                totalPriceMinor: definition.totalPriceMinor,
                currency: definition.currency,
                isTransferable: definition.isTransferable,
                validityDays: definition.validityDays,
                soldAt: now,
                expiresAt: definition.validityDays.map {
                    now.addingTimeInterval(TimeInterval($0) * 86_400)
                },
                status: .active,
                remainingSessions: items.reduce(0) { $0 + $1.quantityTotal },
                outstandingMinor: definition.totalPriceMinor,
                refundedSessions: 0,
                refundAmountMinor: 0,
                refundSettlementStatus: nil,
                refundedAt: nil,
                refundReason: nil,
                transferredFromPackageId: nil,
                note: input.note,
                version: 1,
                items: items,
                createdAt: now
            )
            packageRecords.append(sold)
            ledgerEntries[sold.id] = items.map {
                entry(sold, $0, .purchase, delta: $0.quantityTotal, reason: nil)
            }
            if let key = idempotencyKey { idempotency[key] = sold.id }
            return sold
        }
    }

    func packages(
        customerId: String,
        cursor: String?,
        limit: Int?,
        status: CustomerPackageStatus?
    ) async throws -> Page<CustomerPackage> {
        await latency(0.3)
        return withLock {
            let rows = packageRecords
                .filter { $0.customerId == customerId }
                .filter { status == nil || $0.status == status }
                .sorted { $0.soldAt > $1.soldAt }
            return Page(data: rows, pageInfo: PageInfo(nextCursor: nil, hasMore: false))
        }
    }

    func package(id: String) async throws -> CustomerPackage {
        await latency(0.2)
        return try withLock {
            guard let found = packageRecords.first(where: { $0.id == id }) else { throw notFound() }
            return found
        }
    }

    func ledger(
        packageId: String,
        cursor: String?,
        limit: Int?
    ) async throws -> Page<PackageLedgerEntry> {
        await latency(0.3)
        return withLock {
            let rows = (ledgerEntries[packageId] ?? []).sorted { $0.createdAt > $1.createdAt }
            return Page(data: rows, pageInfo: PageInfo(nextCursor: nil, hasMore: false))
        }
    }

    // MARK: Operasyonlar

    func entitlements(
        customerId: String,
        serviceId: String?,
        branchId: String?
    ) async throws -> [PackageEntitlement] {
        await latency(0.25)
        return withLock {
            let now = Date()
            return packageRecords
                .filter { $0.customerId == customerId && $0.isConsumable(now: now) }
                .filter { branchId == nil || $0.branchId == branchId }
                .flatMap { pkg in
                    pkg.items
                        .filter { $0.remainingSessions > 0 }
                        .filter { serviceId == nil || $0.serviceId == serviceId }
                        .map { item in
                            PackageEntitlement(
                                customerPackageItemId: item.id,
                                customerPackageId: pkg.id,
                                packageName: pkg.name,
                                serviceId: item.serviceId,
                                serviceName: item.serviceName,
                                remainingSessions: item.remainingSessions,
                                expiresAt: pkg.expiresAt,
                                branchId: pkg.branchId
                            )
                        }
                }
        }
    }

    func consume(
        appointmentId: String,
        _ input: ConsumePackageInput,
        idempotencyKey: String?
    ) async throws -> ConsumePackageResult {
        await latency(0.5)
        return try withLock {
            var consumed = 0
            for line in input.lines {
                // Bağlama her durumda yapılır; DÜŞME yalnız randevu zaten
                // `completed` ise. Sunucudaki kural bu ve mock'un burada
                // ayrışması, arayüzü canlıda ilk denemede yanıltırdı.
                let status = booking.bindPackageItem(
                    appointmentId: appointmentId,
                    appointmentServiceId: line.appointmentServiceId,
                    customerPackageItemId: line.customerPackageItemId
                )
                guard status == .completed else { continue }
                try apply(
                    itemId: line.customerPackageItemId,
                    type: .consume,
                    delta: -1,
                    reason: nil,
                    appointmentId: appointmentId
                )
                consumed += 1
            }
            return ConsumePackageResult(bound: input.lines.count, consumed: consumed)
        }
    }

    func adjust(
        id: String,
        version: Int,
        _ input: AdjustPackageInput
    ) async throws -> CustomerPackage {
        await latency(0.5)
        return try withLock {
            guard let current = packageRecords.first(where: { $0.id == id }) else { throw notFound() }
            guard current.version == version else { throw versionConflict() }
            guard input.isValid else { throw validation("Düzeltme gerekçesi zorunlu") }
            for item in input.items {
                try apply(
                    itemId: item.customerPackageItemId,
                    type: .manualAdjustment,
                    delta: item.delta,
                    reason: input.reason,
                    appointmentId: nil
                )
            }
            return try bumpVersion(of: id)
        }
    }

    func refund(
        id: String,
        version: Int,
        _ input: RefundPackageInput,
        idempotencyKey: String?
    ) async throws -> RefundResult {
        await latency(0.6)
        return try withLock {
            guard let current = packageRecords.first(where: { $0.id == id }) else { throw notFound() }
            guard current.version == version else { throw versionConflict() }
            guard current.status.isOpen else { throw expired() }

            let lines = input.items ?? current.items
                .filter { $0.remainingSessions > 0 }
                .map { RefundItemInput(customerPackageItemId: $0.id, sessions: $0.remainingSessions) }
            guard !lines.isEmpty else { throw conflict("İade edilecek kalan hak yok") }

            var refundedSessions = 0
            var amount = 0
            for line in lines {
                guard let item = current.items.first(where: { $0.id == line.customerPackageItemId })
                else { throw notFound() }
                guard line.sessions <= item.remainingSessions else { throw exhausted() }
                // Tutar SATIŞ ANINDAKİ tahsisten hesaplanır, güncel katalogdan değil.
                let unit = item.quantityTotal > 0 ? item.itemTotalMinor / item.quantityTotal : 0
                amount += unit * line.sessions
                refundedSessions += line.sessions
                try apply(
                    itemId: item.id,
                    type: .refund,
                    delta: -line.sessions,
                    reason: input.reason,
                    appointmentId: nil
                )
            }

            guard let index = packageRecords.firstIndex(where: { $0.id == id }) else { throw notFound() }
            let updated = packageRecords[index]
            packageRecords[index] = Self.copy(
                updated,
                status: updated.remainingSessions == 0 ? .refunded : updated.status,
                refundedSessions: updated.refundedSessions + refundedSessions,
                refundAmountMinor: updated.refundAmountMinor + amount,
                // Kasa hareketi YOK: borç doğar, tahsilat Faz 6.2'de bağlanır.
                refundSettlementStatus: "pending",
                refundedAt: Date(),
                refundReason: input.reason,
                version: updated.version + 1
            )
            return RefundResult(
                refundedSessions: refundedSessions,
                refundAmountMinor: amount,
                settlementStatus: "pending"
            )
        }
    }

    func transfer(
        id: String,
        version: Int,
        _ input: TransferPackageInput,
        idempotencyKey: String?
    ) async throws -> CustomerPackage {
        await latency(0.6)
        return try withLock {
            if let key = idempotencyKey, let existingId = idempotency[key],
               let existing = packageRecords.first(where: { $0.id == existingId }) {
                return existing
            }
            guard let source = packageRecords.first(where: { $0.id == id }) else { throw notFound() }
            guard source.version == version else { throw versionConflict() }
            guard source.isTransferable else { throw conflict("Bu paket devredilemez") }
            guard source.customerId != input.targetCustomerId else {
                throw validation("Paket aynı müşteriye devredilemez")
            }
            guard customers.snapshot.contains(where: { $0.id == input.targetCustomerId }) else {
                throw validation("Hedef müşteri bulunamadı")
            }

            let lines = input.items ?? source.items
                .filter { $0.remainingSessions > 0 }
                .map { TransferItemInput(customerPackageItemId: $0.id, sessions: $0.remainingSessions) }
            guard !lines.isEmpty else { throw conflict("Devredilecek kalan hak yok") }

            let now = Date()
            var targetItems: [CustomerPackageItem] = []
            for (position, line) in lines.enumerated() {
                guard let item = source.items.first(where: { $0.id == line.customerPackageItemId })
                else { throw notFound() }
                guard line.sessions <= item.remainingSessions else { throw exhausted() }
                let unit = item.quantityTotal > 0 ? item.itemTotalMinor / item.quantityTotal : 0
                targetItems.append(
                    CustomerPackageItem(
                        id: MockIDs.uuid(),
                        serviceId: item.serviceId,
                        serviceName: item.serviceName,
                        quantityTotal: line.sessions,
                        remainingSessions: line.sessions,
                        unitListPriceMinor: item.unitListPriceMinor,
                        itemTotalMinor: unit * line.sessions,
                        outstandingMinor: unit * line.sessions,
                        sortOrder: position
                    )
                )
                try apply(
                    itemId: item.id,
                    type: .transferOut,
                    delta: -line.sessions,
                    reason: input.reason,
                    appointmentId: nil
                )
            }

            let target = CustomerPackage(
                id: MockIDs.uuid(),
                customerId: input.targetCustomerId,
                branchId: source.branchId,
                definitionId: source.definitionId,
                name: source.name,
                definitionRevision: source.definitionRevision,
                totalPriceMinor: targetItems.reduce(0) { $0 + $1.itemTotalMinor },
                currency: source.currency,
                isTransferable: source.isTransferable,
                validityDays: source.validityDays,
                soldAt: now,
                expiresAt: source.expiresAt,
                status: .active,
                remainingSessions: targetItems.reduce(0) { $0 + $1.remainingSessions },
                outstandingMinor: targetItems.reduce(0) { $0 + $1.outstandingMinor },
                refundedSessions: 0,
                refundAmountMinor: 0,
                refundSettlementStatus: nil,
                refundedAt: nil,
                refundReason: nil,
                transferredFromPackageId: source.id,
                note: nil,
                version: 1,
                items: targetItems,
                createdAt: now
            )
            packageRecords.append(target)
            ledgerEntries[target.id] = targetItems.map {
                entry(target, $0, .transferIn, delta: $0.quantityTotal, reason: input.reason)
            }
            _ = try bumpVersion(of: source.id)
            if let index = packageRecords.firstIndex(where: { $0.id == source.id }),
               packageRecords[index].remainingSessions == 0 {
                packageRecords[index] = Self.copy(packageRecords[index], status: .transferred)
            }
            if let key = idempotencyKey { idempotency[key] = target.id }
            return target
        }
    }

    // MARK: Raporlar

    func outstandingReport(
        branchId: String?,
        serviceId: String?,
        groupBy: OutstandingGrouping?
    ) async throws -> OutstandingReport {
        await latency(0.4)
        return withLock {
            let grouping = groupBy ?? .service
            let names = Dictionary(
                customers.snapshot.map { ($0.id, $0.fullName) },
                uniquingKeysWith: { first, _ in first }
            )
            let open = packageRecords
                .filter { $0.status == .active && $0.remainingSessions > 0 }
                .filter { branchId == nil || $0.branchId == branchId }

            var rows: [String: (label: String, packages: Set<String>, sessions: Int, minor: Int)] = [:]
            for pkg in open {
                for item in pkg.items where item.remainingSessions > 0 {
                    if let serviceId, item.serviceId != serviceId { continue }
                    let key: String
                    let label: String
                    switch grouping {
                    case .service: key = item.serviceId; label = item.serviceName
                    case .customer: key = pkg.customerId; label = names[pkg.customerId] ?? "Müşteri"
                    case .branch: key = pkg.branchId; label = Self.branchName(pkg.branchId)
                    }
                    var bucket = rows[key] ?? (label, [], 0, 0)
                    bucket.packages.insert(pkg.id)
                    bucket.sessions += item.remainingSessions
                    bucket.minor += item.outstandingMinor
                    rows[key] = bucket
                }
            }

            let data = rows
                .map { key, value in
                    OutstandingRow(
                        groupId: key,
                        groupLabel: value.label,
                        packages: value.packages.count,
                        remainingSessions: value.sessions,
                        outstandingMinor: value.minor
                    )
                }
                .sorted { $0.outstandingMinor > $1.outstandingMinor }

            return OutstandingReport(
                totals: OutstandingTotals(
                    packages: Set(open.map(\.id)).count,
                    remainingSessions: data.reduce(0) { $0 + $1.remainingSessions },
                    outstandingMinor: data.reduce(0) { $0 + $1.outstandingMinor },
                    currency: "TRY"
                ),
                data: data
            )
        }
    }

    func expiringReport(
        from: Date,
        to: Date,
        branchId: String?,
        cursor: String?,
        limit: Int?
    ) async throws -> ExpiringReport {
        await latency(0.4)
        return withLock {
            let names = Dictionary(
                customers.snapshot.map { ($0.id, $0.fullName) },
                uniquingKeysWith: { first, _ in first }
            )
            let rows = packageRecords
                .filter { $0.status == .active && $0.remainingSessions > 0 }
                .filter { branchId == nil || $0.branchId == branchId }
                // Aralık YARI AÇIK: `to` dahil değil.
                .compactMap { pkg -> ExpiringRow? in
                    guard let expiresAt = pkg.expiresAt, expiresAt >= from, expiresAt < to
                    else { return nil }
                    return ExpiringRow(
                        customerPackageId: pkg.id,
                        customerId: pkg.customerId,
                        customerName: names[pkg.customerId] ?? "Müşteri",
                        packageName: pkg.name,
                        branchId: pkg.branchId,
                        remainingSessions: pkg.remainingSessions,
                        expiresAt: expiresAt,
                        outstandingMinor: pkg.outstandingMinor
                    )
                }
                .sorted { $0.expiresAt < $1.expiresAt }
            return ExpiringReport(
                data: rows,
                pageInfo: PageInfo(nextCursor: nil, hasMore: false)
            )
        }
    }

    func usageReport(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: UsageGrouping?
    ) async throws -> UsageReport {
        await latency(0.4)
        return withLock {
            let grouping = groupBy ?? .service
            var rows: [String: UsageRow] = [:]
            for pkg in packageRecords {
                if let branchId, pkg.branchId != branchId { continue }
                for row in ledgerEntries[pkg.id] ?? [] {
                    guard row.createdAt >= from, row.createdAt < to else { continue }
                    let key = grouping == .service ? row.serviceId : pkg.branchId
                    let label = grouping == .service ? row.serviceName : Self.branchName(pkg.branchId)
                    var bucket = rows[key] ?? UsageRow(
                        groupId: key, groupLabel: label, purchased: 0, consumed: 0,
                        refunded: 0, expired: 0, transferred: 0, adjusted: 0
                    )
                    let count = abs(row.delta)
                    switch row.entryType {
                    case .purchase:
                        bucket = Self.adding(bucket, purchased: count)
                    case .consume:
                        // Ters kayıt tüketimi geri alır: pozitif delta düşer.
                        bucket = Self.adding(bucket, consumed: row.delta < 0 ? count : -count)
                    case .refund:
                        bucket = Self.adding(bucket, refunded: count)
                    case .expire:
                        bucket = Self.adding(bucket, expired: count)
                    case .transferIn, .transferOut:
                        bucket = Self.adding(bucket, transferred: count)
                    case .manualAdjustment, .unknown:
                        bucket = Self.adding(bucket, adjusted: count)
                    }
                    rows[key] = bucket
                }
            }
            return UsageReport(data: rows.values.sorted { $0.groupLabel < $1.groupLabel })
        }
    }

    // MARK: Defter uygulaması

    /// Tek yazma noktası. Sunucudaki `apply_package_ledger_entry()` trigger'ının
    /// aynası: **hak kontrolü yazmadan önce** yapılır ve kendi hatasını döner.
    private func apply(
        itemId: String,
        type: LedgerEntryType,
        delta: Int,
        reason: String?,
        appointmentId: String?
    ) throws {
        guard let packageIndex = packageRecords.firstIndex(where: { pkg in
            pkg.items.contains { $0.id == itemId }
        }) else { throw notFound() }

        let pkg = packageRecords[packageIndex]
        if delta < 0, !pkg.isConsumable() { throw expired() }

        guard let itemIndex = pkg.items.firstIndex(where: { $0.id == itemId }) else {
            throw notFound()
        }
        let item = pkg.items[itemIndex]
        guard item.remainingSessions + delta >= 0 else { throw exhausted() }

        let remaining = item.remainingSessions + delta
        let unit = item.quantityTotal > 0 ? item.itemTotalMinor / item.quantityTotal : 0
        var items = pkg.items
        items[itemIndex] = CustomerPackageItem(
            id: item.id,
            serviceId: item.serviceId,
            serviceName: item.serviceName,
            quantityTotal: item.quantityTotal,
            remainingSessions: remaining,
            unitListPriceMinor: item.unitListPriceMinor,
            itemTotalMinor: item.itemTotalMinor,
            outstandingMinor: unit * remaining,
            sortOrder: item.sortOrder
        )
        packageRecords[packageIndex] = Self.copy(
            pkg,
            remainingSessions: items.reduce(0) { $0 + $1.remainingSessions },
            outstandingMinor: items.reduce(0) { $0 + $1.outstandingMinor },
            items: items
        )
        ledgerEntries[pkg.id, default: []].insert(
            entry(pkg, items[itemIndex], type, delta: delta, reason: reason, appointmentId: appointmentId),
            at: 0
        )
    }

    private func bumpVersion(of id: String) throws -> CustomerPackage {
        guard let index = packageRecords.firstIndex(where: { $0.id == id }) else { throw notFound() }
        packageRecords[index] = Self.copy(packageRecords[index], version: packageRecords[index].version + 1)
        return packageRecords[index]
    }

    private func entry(
        _ pkg: CustomerPackage,
        _ item: CustomerPackageItem,
        _ type: LedgerEntryType,
        delta: Int,
        reason: String?,
        appointmentId: String? = nil
    ) -> PackageLedgerEntry {
        PackageLedgerEntry(
            id: MockIDs.uuid(),
            customerPackageItemId: item.id,
            serviceId: item.serviceId,
            serviceName: item.serviceName,
            entryType: type,
            delta: delta,
            appointmentId: appointmentId,
            actorUserId: MockIDs.userOwner,
            reason: reason,
            reversesEntryId: nil,
            createdAt: Date()
        )
    }

    // MARK: Yardımcılar

    /// Largest-remainder dağıtımı — sunucudaki `allocateMinor` ile aynı kural:
    /// paylar toplamı daima `total`a eşittir, kuruş kaybolmaz.
    static func allocate(_ total: Int, weights: [Int]) -> [Int] {
        let sum = weights.reduce(0, +)
        guard sum > 0 else {
            guard !weights.isEmpty else { return [] }
            var equal = Array(repeating: total / weights.count, count: weights.count)
            equal[0] += total - equal.reduce(0, +)
            return equal
        }
        var shares = weights.map { $0 * total / sum }
        let remainders = weights.enumerated()
            .map { (index: $0.offset, remainder: ($0.element * total) % sum) }
            .sorted { $0.remainder > $1.remainder }
        var leftover = total - shares.reduce(0, +)
        for entry in remainders where leftover > 0 {
            shares[entry.index] += 1
            leftover -= 1
        }
        return shares
    }

    private static func branchName(_ id: String) -> String {
        switch id {
        case MockIDs.branchNisantasi: return "Nişantaşı"
        case MockIDs.branchBagdat: return "Bağdat Caddesi"
        default: return "Şube"
        }
    }

    private static func adding(
        _ row: UsageRow,
        purchased: Int = 0,
        consumed: Int = 0,
        refunded: Int = 0,
        expired: Int = 0,
        transferred: Int = 0,
        adjusted: Int = 0
    ) -> UsageRow {
        UsageRow(
            groupId: row.groupId,
            groupLabel: row.groupLabel,
            purchased: row.purchased + purchased,
            consumed: row.consumed + consumed,
            refunded: row.refunded + refunded,
            expired: row.expired + expired,
            transferred: row.transferred + transferred,
            adjusted: row.adjusted + adjusted
        )
    }

    /// Değer tipini alan alan yeniden kurmak yerine tek yerde kopyalamak:
    /// 24 alanlı bir struct'ı her mutasyonda elle yazmak, bir alanın sessizce
    /// sıfırlanması için yeterli bir davet.
    private static func copy(
        _ pkg: CustomerPackage,
        status: CustomerPackageStatus? = nil,
        remainingSessions: Int? = nil,
        outstandingMinor: Int? = nil,
        refundedSessions: Int? = nil,
        refundAmountMinor: Int? = nil,
        refundSettlementStatus: String? = nil,
        refundedAt: Date? = nil,
        refundReason: String? = nil,
        version: Int? = nil,
        items: [CustomerPackageItem]? = nil
    ) -> CustomerPackage {
        CustomerPackage(
            id: pkg.id,
            customerId: pkg.customerId,
            branchId: pkg.branchId,
            definitionId: pkg.definitionId,
            name: pkg.name,
            definitionRevision: pkg.definitionRevision,
            totalPriceMinor: pkg.totalPriceMinor,
            currency: pkg.currency,
            isTransferable: pkg.isTransferable,
            validityDays: pkg.validityDays,
            soldAt: pkg.soldAt,
            expiresAt: pkg.expiresAt,
            status: status ?? pkg.status,
            remainingSessions: remainingSessions ?? pkg.remainingSessions,
            outstandingMinor: outstandingMinor ?? pkg.outstandingMinor,
            refundedSessions: refundedSessions ?? pkg.refundedSessions,
            refundAmountMinor: refundAmountMinor ?? pkg.refundAmountMinor,
            refundSettlementStatus: refundSettlementStatus ?? pkg.refundSettlementStatus,
            refundedAt: refundedAt ?? pkg.refundedAt,
            refundReason: refundReason ?? pkg.refundReason,
            transferredFromPackageId: pkg.transferredFromPackageId,
            note: pkg.note,
            version: version ?? pkg.version,
            items: items ?? pkg.items,
            createdAt: pkg.createdAt
        )
    }
}
