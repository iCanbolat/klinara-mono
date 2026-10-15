import Foundation

/// Anlık olay soketi — uygulama öndeyken açık, arka plana geçince kapalı.
///
/// Push bu işin aracı değil: teslimi garanti değil, Apple sık gönderimi
/// kısıyor ve uygulama zaten açıkken gereksiz. Soket kopuksa hiçbir şey
/// bozulmaz; ekranlar aşağı çekerek yenileme ve öne dönüşte tazelemeyle çalışır.
///
/// Yeniden bağlanma üstel bekler (1 sn → 30 sn), ve bağlantı yeniden
/// kurulduğunda ``RealtimeEvent/resync`` yayar: kopukken kaçan olay bilinemez.
/// `start()` sonrasındaki İLK bağlantı resync yaymaz — çağıran o an zaten
/// tazeliyor (açılış ya da öne dönüş).
@MainActor
final class RealtimeConnection {

    var onEvent: ((RealtimeEvent) -> Void)?

    private let service: any RealtimeService
    private let session: URLSession
    private var loop: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?

    private static let retryMin: Duration = .seconds(1)
    private static let retryMax: Duration = .seconds(30)
    /// Sunucunun kimlik/yetki reddi — yeniden denemek aynı cevabı alır.
    private static let fatalCloseCodes: Set<Int> = [4401, 4403]

    init(service: any RealtimeService) {
        self.service = service
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        session = URLSession(configuration: configuration)
    }

    var isRunning: Bool { loop != nil }

    func start() {
        guard loop == nil else { return }
        loop = Task { [weak self] in await self?.run() }
    }

    func stop() {
        loop?.cancel()
        loop = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
    }

    // MARK: Döngü

    private func run() async {
        var retry = Self.retryMin
        var connectedBefore = false

        while !Task.isCancelled {
            let outcome = await connectOnce(announceResync: connectedBefore)
            if Task.isCancelled { return }

            switch outcome {
            case .stopped:
                loop = nil
                return
            case .dropped(let wasReady):
                if wasReady {
                    connectedBefore = true
                    retry = Self.retryMin
                }
            }

            // Sunucu yeniden başladığında tüm cihazlar aynı anda dönmesin.
            let jitter = Double.random(in: 0.5...1.5)
            try? await Task.sleep(for: retry * jitter)
            retry = min(retry * 2, Self.retryMax)
        }
    }

    private enum Outcome {
        /// Kalıcı ret (oturum yok, yetki yok) — bir sonraki `start()`a kadar dur.
        case stopped
        case dropped(wasReady: Bool)
    }

    private func connectOnce(announceResync: Bool) async -> Outcome {
        let ticket: String
        do {
            ticket = try await service.ticket()
        } catch let error as APIError {
            if case .problem(let problem) = error, problem.status == 401 || problem.status == 403 {
                return .stopped
            }
            return .dropped(wasReady: false)
        } catch {
            return .dropped(wasReady: false)
        }
        if Task.isCancelled { return .dropped(wasReady: false) }

        let task = session.webSocketTask(with: service.socketURL)
        socket = task
        task.resume()
        defer {
            task.cancel(with: .goingAway, reason: nil)
            if socket === task { socket = nil }
        }

        do {
            let auth = #"{"type":"auth","ticket":"\#(ticket)"}"#
            try await task.send(.string(auth))
        } catch {
            return .dropped(wasReady: false)
        }

        var ready = false
        while !Task.isCancelled {
            let message: URLSessionWebSocketTask.Message
            do {
                message = try await task.receive()
            } catch {
                if Self.fatalCloseCodes.contains(task.closeCode.rawValue) { return .stopped }
                return .dropped(wasReady: ready)
            }
            guard case .string(let text) = message,
                  let frame = RealtimeFrame.decode(text)
            else { continue }

            switch frame {
            case .ready:
                ready = true
                if announceResync { onEvent?(.resync) }
            case .event(let event):
                onEvent?(event)
            }
        }
        return .dropped(wasReady: ready)
    }
}

/// Soketten gelen tek bir çerçeve. Bilinmeyen türler yok sayılır: sunucu yeni
/// bir olay türü eklediğinde eski uygulama sürümü bozulmamalı.
nonisolated enum RealtimeFrame: Equatable, Sendable {
    case ready
    case event(RealtimeEvent)

    private struct Wire: Decodable {
        let type: String
        let kind: String?
        let branchId: String?
        let days: [String]?
    }

    static func decode(_ text: String) -> RealtimeFrame? {
        guard let data = text.data(using: .utf8),
              let wire = try? JSONDecoder().decode(Wire.self, from: data)
        else { return nil }
        switch wire.type {
        case "ready":
            return .ready
        case "resync":
            return .event(.resync)
        case "staff_notification":
            return wire.kind.map { .event(.staffNotification(kind: $0)) }
        case "calendar_changed":
            guard let branchId = wire.branchId, let days = wire.days else { return nil }
            return .event(.calendarChanged(branchId: branchId, days: days))
        default:
            return nil
        }
    }
}
