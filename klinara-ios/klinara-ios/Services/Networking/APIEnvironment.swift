import Foundation

/// API kökünün tek kaynağı.
///
/// Değer `Info.plist`'teki `KlinaraAPIBaseURL` anahtarından okunur; böylece
/// fiziksel cihazdan Mac'e bağlanmak için kod değil yapılandırma değişir.
/// Anahtar yoksa süreç **açılışta ölür** — sessizce yanlış bir kökle
/// çalışmaktansa hatayı ilk saniyede görmek yeğdir (sunucu tarafındaki
/// `env.validation.ts` fail-fast kuralının istemci karşılığı).
enum APIEnvironment {

    static let baseURL: URL = {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "KlinaraAPIBaseURL") as? String,
            let url = URL(string: raw)
        else {
            fatalError("Info.plist içinde geçerli bir KlinaraAPIBaseURL yok.")
        }
        return url
    }()

    /// Passkey `rpId`'si. Sunucudaki `WEBAUTHN_RP_ID` ile birebir aynı olmalı,
    /// aksi hâlde imza doğrulanmaz.
    static var relyingPartyIdentifier: String {
        Bundle.main.object(forInfoDictionaryKey: "KlinaraWebAuthnRPID") as? String
            ?? baseURL.host()
            ?? "localhost"
    }
}
