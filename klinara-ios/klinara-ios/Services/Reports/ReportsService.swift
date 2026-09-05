import Foundation

/// Batch 10.1 raporları.
///
/// Paket raporları (5.4) `PackagesService`te kalıyor: sunucuda da ayrı bir
/// controller ve ayrı bir izin altındalar (`package:read`). Onları buraya
/// taşımak, izin sınırını istemcide bulanıklaştırırdı.
protocol ReportsService: Sendable {

    /// `GET /reports/occupancy`
    func occupancy(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: OccupancyGrouping?,
        compareToPrevious: Bool
    ) async throws -> OccupancyReport

    /// `GET /reports/revenue` — `report.revenue:read` ister.
    func revenue(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: RevenueGrouping?,
        compareToPrevious: Bool
    ) async throws -> RevenueReport

    /// `GET /reports/staff-performance`
    ///
    /// Yalnız `report.performance:read.own` taşıyan çağıran KENDİ satırına
    /// kilitlenir; gönderilen `staffProfileId` sunucuda yok sayılır ve yanıt
    /// `scope: .own` döner.
    func staffPerformance(
        from: Date,
        to: Date,
        branchId: String?,
        compareToPrevious: Bool
    ) async throws -> StaffPerformanceReport

    /// `GET /reports/no-show`
    func noShow(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: NoShowGrouping?,
        compareToPrevious: Bool
    ) async throws -> NoShowReport

    /// `GET /reports/retention`
    func retention(
        from: Date,
        to: Date,
        branchId: String?,
        compareToPrevious: Bool
    ) async throws -> RetentionReport
}

nonisolated struct LiveReportsService: ReportsService {

    let client: APIClient

    /// Her rapor ucunun ortak sorgusu.
    ///
    /// `compareTo` yalnız istendiğinde ekleniyor: sunucu varsayılanı `none` ve
    /// her isteğe `compareTo=none` yazmak, önceki dönemi de hesaplayan bir yol
    /// varmış gibi okunurdu.
    private func baseQuery(
        from: Date,
        to: Date,
        branchId: String?,
        compareToPrevious: Bool
    ) -> [URLQueryItem] {
        var query = [
            URLQueryItem(name: "from", value: KlinaraCoding.timestamp(from)),
            URLQueryItem(name: "to", value: KlinaraCoding.timestamp(to)),
        ]
        if let branchId { query.append(URLQueryItem(name: "branchId", value: branchId)) }
        if compareToPrevious { query.append(URLQueryItem(name: "compareTo", value: "previous")) }
        return query
    }

    func occupancy(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: OccupancyGrouping?,
        compareToPrevious: Bool
    ) async throws -> OccupancyReport {
        var query = baseQuery(from: from, to: to, branchId: branchId, compareToPrevious: compareToPrevious)
        if let groupBy { query.append(URLQueryItem(name: "groupBy", value: groupBy.rawValue)) }
        return try await client.send(APIRequest.get("reports/occupancy", query: query))
    }

    func revenue(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: RevenueGrouping?,
        compareToPrevious: Bool
    ) async throws -> RevenueReport {
        var query = baseQuery(from: from, to: to, branchId: branchId, compareToPrevious: compareToPrevious)
        if let groupBy { query.append(URLQueryItem(name: "groupBy", value: groupBy.rawValue)) }
        return try await client.send(APIRequest.get("reports/revenue", query: query))
    }

    func staffPerformance(
        from: Date,
        to: Date,
        branchId: String?,
        compareToPrevious: Bool
    ) async throws -> StaffPerformanceReport {
        let query = baseQuery(from: from, to: to, branchId: branchId, compareToPrevious: compareToPrevious)
        return try await client.send(APIRequest.get("reports/staff-performance", query: query))
    }

    func noShow(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: NoShowGrouping?,
        compareToPrevious: Bool
    ) async throws -> NoShowReport {
        var query = baseQuery(from: from, to: to, branchId: branchId, compareToPrevious: compareToPrevious)
        if let groupBy { query.append(URLQueryItem(name: "groupBy", value: groupBy.rawValue)) }
        return try await client.send(APIRequest.get("reports/no-show", query: query))
    }

    func retention(
        from: Date,
        to: Date,
        branchId: String?,
        compareToPrevious: Bool
    ) async throws -> RetentionReport {
        let query = baseQuery(from: from, to: to, branchId: branchId, compareToPrevious: compareToPrevious)
        return try await client.send(APIRequest.get("reports/retention", query: query))
    }
}
