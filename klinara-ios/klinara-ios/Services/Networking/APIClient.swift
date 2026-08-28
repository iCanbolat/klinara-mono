import Foundation

/// Uygulamanın tek HTTP boru hattı.
///
/// Ekranlar ve servisler `URLSession` görmez. Buradaki üç şey tek yerde
/// olduğu için doğrudur ve öyle kalır:
///
/// 1. **Başlıklar** — `Authorization`, `X-Branch-Id`, `X-Request-Id` her istekte
///    aynı kuralla eklenir; bir uçta unutulması mümkün değil.
/// 2. **Hata dönüşümü** — 2xx dışı her yanıt RFC 9457 `problem+json` olarak
///    çözülür ve ``APIError``'a indirgenir; ekranlar HTTP durum kodu bilmez.
/// 3. **Token yenileme** — `actor` izolasyonu sayesinde eş zamanlı N istek tek
///    bir `POST /auth/refresh` tetikler. Aksi hâlde uygulama açılışında paralel
///    koşan üç istek üç kez rotate ederdi ve refresh **reuse detection**
///    sunucuda tüm oturum ailesini iptal ederdi — kullanıcı sebepsiz çıkardı.
actor APIClient {

    private let baseURL: URL
    private let session: URLSession
    private let tokens: TokenStore

    /// Yenileme de başarısız olduğunda çağrılır — kabuk kullanıcıyı giriş
    /// ekranına döndürür. `APIClient` gezinme bilmez, yalnız haber verir.
    private var onSessionExpired: (@Sendable () -> Void)?

    /// Süren yenileme işi. Tek-uçuş (single-flight) garantisi buradan gelir.
    private var refreshTask: Task<Void, any Error>?

    init(baseURL: URL = APIEnvironment.baseURL, tokens: TokenStore = .shared) {
        self.baseURL = baseURL
        self.tokens = tokens

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.waitsForConnectivity = false
        // Yanıt önbelleği KAPALI: hasta/randevu verisi diskte artakalmamalı,
        // ayrıca "kaydettim ama liste eski" hatasının en sık sebebi budur.
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: configuration)
    }

    func setSessionExpiredHandler(_ handler: @escaping @Sendable () -> Void) {
        onSessionExpired = handler
    }

    // MARK: - Kodlama

    /// Mock servis de aynısını kullanır — bkz. ``KlinaraCoding``.
    static let decoder = KlinaraCoding.decoder()
    private static let encoder = KlinaraCoding.encoder()

    // MARK: - Gönderim

    /// Yanıt gövdesi beklenen çağrılar.
    func send<Response: Decodable & Sendable>(_ request: APIRequest) async throws -> Response {
        let data = try await perform(request)
        // `204 No Content` bekleyen çağrılar boş gövdeyi çözmeye çalışmasın.
        if let empty = EmptyResponse() as? Response { return empty }
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.malformedResponse(String(describing: error))
        }
    }

    /// Gövdesi umursanmayan çağrılar (`204`, ya da yanıtı kullanılmayan `POST`).
    func send(_ request: APIRequest) async throws {
        _ = try await perform(request)
    }

    /// **Boş gövdeli `200`**i `nil`e çeviren çağrılar.
    ///
    /// `GET /integrations/whatsapp` hesap kurulmamışken `200` ile BOŞ bir gövde
    /// döndürüyor (denetleyici `null` döndürüyor, Nest onu hiç yazmıyor).
    /// ``send(_:)`` bunu `malformedResponse` sayardı ve ekran, kullanıcının
    /// henüz yapmadığı bir kurulumu bozulmuş gibi gösterirdi. Ayrı bir
    /// aşırı yükleme, "boş yanıt beklenen bir sonuçtur" kararını çağrı
    /// yerinde görünür kılıyor.
    func sendOptional<Response: Decodable & Sendable>(
        _ request: APIRequest
    ) async throws -> Response? {
        let data = try await perform(request)
        guard !data.isEmpty else { return nil }
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.malformedResponse(String(describing: error))
        }
    }

    // MARK: - İmzalı yükleme

    /// İmzalı adrese doğrudan PUT — dosya içeriği API sürecinden GEÇMEZ.
    ///
    /// Bu istek uygulamanın kendi sunucusuna değil, **nesne depolamasına**
    /// (S3/MinIO ya da yerel geliştirme kapısı) gidiyor. Bu yüzden:
    /// - `Authorization` ve `X-Branch-Id` **gönderilmez**. Oturum token'ını
    ///   üçüncü bir tarafa sızdırmak kabul edilemez; imza zaten yetkidir.
    /// - 401'de token yenileme denenmez — imzanın süresi dolduysa yeni bir
    ///   `presign` gerekir, yeni bir access token değil.
    /// - Yanıt `problem+json` değildir; hata ``APIError/uploadFailed(status:)``
    ///   olarak taşınır.
    ///
    /// `Content-Type` `presign` yanıtındaki değerle **birebir aynı** olmalı:
    /// imza onu kapsıyor, farklı bir değer imzayı geçersiz kılar.
    func uploadToSignedURL(_ url: URL, data: Data, contentType: String) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = HTTPMethod.put.rawValue
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")

        let response: URLResponse
        do {
            (_, response) = try await session.upload(for: request, from: data)
        } catch let error as URLError {
            throw error.code == .cancelled ? APIError.cancelled : APIError.network
        } catch {
            throw APIError.network
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.malformedResponse("HTTP olmayan yanıt")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.uploadFailed(status: http.statusCode)
        }
    }

    // MARK: - Çekirdek

    private func perform(_ request: APIRequest, isRetry: Bool = false) async throws -> Data {
        let urlRequest = try buildURLRequest(request)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: urlRequest)
        } catch let error as URLError {
            throw error.code == .cancelled ? APIError.cancelled : APIError.network
        } catch {
            throw APIError.network
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.malformedResponse("HTTP olmayan yanıt")
        }

        if (200..<300).contains(http.statusCode) { return data }

        // 401 → bir kez yenile, bir kez tekrarla. `isRetry` bayrağı olmadan
        // sunucu ısrarla 401 döndürdüğünde sonsuz döngüye girilirdi.
        if http.statusCode == 401, request.requiresAuth, request.bearerOverride == nil, !isRetry {
            do {
                try await refreshTokens()
            } catch {
                expireSession()
                throw problem(from: data, status: http.statusCode)
            }
            return try await perform(request, isRetry: true)
        }

        let failure = problem(from: data, status: http.statusCode)
        if failure.invalidatesSession { expireSession() }
        throw failure
    }

    private func buildURLRequest(_ request: APIRequest) throws -> URLRequest {
        var components = URLComponents(
            url: baseURL.appending(path: request.path),
            resolvingAgainstBaseURL: false
        )
        if !request.query.isEmpty { components?.queryItems = request.query }

        guard let url = components?.url else {
            throw APIError.malformedResponse("Geçersiz istek yolu: \(request.path)")
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method.rawValue
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        urlRequest.setValue(UUID().uuidString, forHTTPHeaderField: "X-Request-Id")

        if let override = request.bearerOverride {
            urlRequest.setValue("Bearer \(override)", forHTTPHeaderField: "Authorization")
        } else if request.requiresAuth, let accessToken = tokens.accessToken {
            urlRequest.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

            // Şube kapsamlı uçlar (`@RequireBranchScope`) bu başlık olmadan 400
            // döner. Kapsamsız uçlarda zararsız: AuthGuard yalnız üyeliği
            // doğrular ve kiracı kapsamlı roller (`tenantWide`) zaten geçer.
            if let branchId = tokens.branchId {
                urlRequest.setValue(branchId, forHTTPHeaderField: "X-Branch-Id")
            }
        }

        if let key = request.idempotencyKey {
            urlRequest.setValue(key, forHTTPHeaderField: "Idempotency-Key")
        }

        if let ifMatch = request.ifMatch {
            urlRequest.setValue(ifMatch, forHTTPHeaderField: "If-Match")
        }

        if let body = request.body {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do {
                urlRequest.httpBody = try Self.encoder.encode(body)
            } catch {
                throw APIError.malformedResponse("İstek gövdesi kodlanamadı: \(error)")
            }
        }

        return urlRequest
    }

    // MARK: - Hata dönüşümü

    private func problem(from data: Data, status: Int) -> APIError {
        if let details = try? Self.decoder.decode(ProblemDetails.self, from: data) {
            return .problem(details)
        }
        // Sunucu problem+json üretemeyecek kadar erken düştü (proxy, gateway).
        // Kullanıcıya yine anlamlı bir şey söyleyebilmek için duruma göre bir
        // kod uyduruyoruz; `title` insan içindir, sözleşme değil.
        return .problem(ProblemDetails(
            code: status >= 500 ? .internalError : .unknown,
            title: "Beklenmeyen yanıt",
            status: status
        ))
    }

    // MARK: - Oturum

    private func refreshTokens() async throws {
        if let refreshTask {
            // Başkası zaten yeniliyor: sonucunu bekle, ikinci bir rotate etme.
            return try await refreshTask.value
        }

        let task = Task<Void, any Error> { [tokens, baseURL, session] in
            guard let refreshToken = tokens.refreshToken else {
                throw APIError.problem(ProblemDetails(
                    code: .unauthenticated,
                    title: "Oturum yok",
                    status: 401
                ))
            }

            var request = URLRequest(url: baseURL.appending(path: "auth/refresh"))
            request.httpMethod = HTTPMethod.post.rawValue
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Request-Id")
            request.httpBody = try JSONEncoder().encode(["refreshToken": refreshToken])

            let (data, response) = try await session.data(for: request)
            guard
                let http = response as? HTTPURLResponse,
                (200..<300).contains(http.statusCode)
            else {
                throw APIError.problem(ProblemDetails(
                    code: .tokenExpired,
                    title: "Oturum yenilenemedi",
                    status: 401
                ))
            }

            let fresh = try APIClient.decoder.decode(AuthTokens.self, from: data)
            tokens.save(fresh)
        }

        refreshTask = task
        defer { refreshTask = nil }
        try await task.value
    }

    private func expireSession() {
        tokens.clear()
        onSessionExpired?()
    }
}
