import SwiftUI

/// Müşteri listesinin oturum ömürlü kopyası.
///
/// Randevu oluştururken müşteri seçmek gerekiyor; her açılışta listeyi yeniden
/// çekmek yerine ``StaffStore``'un kalıbı: bir kez yükle, yazmaları yerelde işle.
///
/// `GET /customers` bugün **sayfalanmıyor ve arama parametresi almıyor** —
/// filtreleme bu yüzden istemcide. Batch 4.1 `GET /customers/search` getirdiğinde
/// değişecek tek yer ``search(_:)``.
@MainActor
@Observable
final class CustomerStore {

    private let service: any CustomerService

    private(set) var state: LoadState<[Customer]> = .loading
    private(set) var isSaving = false

    init(service: any CustomerService) {
        self.service = service
    }

    var customers: [Customer] { state.value ?? [] }

    func customer(id: String) -> Customer? { customers.first { $0.id == id } }

    /// Ad, e-posta veya telefon üzerinden filtre. Boş terim tüm listeyi verir.
    func search(_ term: String) -> [Customer] {
        customers.filter { $0.matches(term) }
    }

    // MARK: Okuma

    func load(force: Bool = false) async {
        if !force, state.value != nil { return }
        state = .loading
        do {
            state = .loaded(try await service.customers())
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    func reload() async { await load(force: true) }

    // MARK: Yazma

    func create(_ input: CreateCustomerInput) async throws -> Customer {
        try await mutating {
            let created = try await service.create(input)
            // Sunucu listeyi en yeniden eskiye sıralıyor; yeni kayıt başa girer.
            state = .loaded([created] + customers)
            return created
        }
    }

    func update(id: String, _ input: UpdateCustomerInput) async throws -> Customer {
        try await mutating {
            let updated = try await service.update(id: id, input)
            replace(updated)
            return updated
        }
    }

    /// Arşivler. Kayıt listeden düşer — sunucuda `deletedAt` doluyor ve
    /// `GET /customers` onu bir daha döndürmüyor.
    func archive(id: String) async throws -> Customer {
        try await mutating {
            let archived = try await service.archive(id: id)
            state = .loaded(customers.filter { $0.id != id })
            return archived
        }
    }

    // MARK: Yardımcılar

    private func replace(_ customer: Customer) {
        state = .loaded(customers.map { $0.id == customer.id ? customer : $0 })
    }

    private func mutating<T>(_ work: () async throws -> T) async throws -> T {
        isSaving = true
        defer { isSaving = false }
        return try await work()
    }
}
