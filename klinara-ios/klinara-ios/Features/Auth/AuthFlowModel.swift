import SwiftUI

/// Giriş ve ilk kurulum akışının tek beyni.
///
/// Ekranlar durum **tutmaz**; ne gösterileceğine ve sıradaki adımın ne
/// olduğuna burası karar verir. Adım atlama kararları (tek klinik → kiracı
/// seçimi yok, tek şube → şube seçimi yok) **sunucu yanıtından** okunur,
/// ekranlarda varsayılmaz.
@MainActor
@Observable
final class AuthFlowModel {

    // MARK: Adımlar

    enum Step: Equatable {
        /// Keychain'den oturum geri yükleniyor.
        case launch
        /// Telefon (varsayılan) veya e-posta.
        case identifier
        case password
        /// İkinci faktör kodu.
        case totp
        /// Kiracı 2FA'yı zorunlu kılmış ama kullanıcı kurmamış.
        case totpSetup
        /// Yedek kodlar — yalnız bir kez gösterilir.
        case backupCodesDisplay
        /// TOTP yerine yedek kod girişi.
        case backupCode
        case forgotPasswordEmail
        case forgotPasswordSent
        case tenantSelect
        case branchSelect
        case phoneVerification
        case passkeyEnrollOffer
        case authenticated
    }

    /// Girişte kullanılan tanımlayıcı. İkisinden **tam olarak biri** gönderilir.
    enum IdentifierMode: Equatable {
        case phone, email
    }

    // MARK: Bağımlılıklar

    private let services: ServiceContainer
    private let auth: any AuthService
    private let passkeys: any PasskeyPerforming
    private let tokens: TokenStore

    /// Varsayılan argümanlar `nil`: `@MainActor` bir init'in varsayılan
    /// ifadeleri nonisolated bağlamda değerlendirilir ve orada
    /// `TokenStore.shared`'a dokunmak Swift 6'da hatadır.
    init(
        services: ServiceContainer,
        passkeys: (any PasskeyPerforming)? = nil,
        tokens: TokenStore? = nil
    ) {
        self.services = services
        self.auth = services.auth
        self.passkeys = passkeys ?? MockPasskeyService()
        self.tokens = tokens ?? .shared
    }

    // MARK: Görünür durum

    private(set) var step: Step = .launch
    private(set) var isBusy = false
    private(set) var error: AuthError?
    private(set) var overlayMessage: String?

    var identifierMode: IdentifierMode = .phone

    // Kullanıcı girdileri
    var phoneE164 = ""
    var email = ""
    var password = ""
    var mfaCode = ""
    var backupCode = ""
    var smsCode = ""
    /// Profilde kayıtlı numara yoksa kullanıcı burada girer.
    ///
    /// Bu alan olmadan akış ölü noktaya düşerdi: davet e-postasıyla açılan bir
    /// hesapta telefon YOKTUR, mobil giriş ise doğrulanmış numara ister —
    /// kullanıcı numarasını girecek bir yer bulamadan doğrulama ekranında
    /// kilitli kalırdı.
    var phoneToVerify = ""
    var forgotPasswordEmail = ""
    var totpSetupCode = ""

    // Sunucudan gelen akış verisi
    private(set) var tenants: [TenantOption] = []
    private(set) var branches: [BranchSummary] = []
    private(set) var profile: MeResponse?
    private(set) var backupCodes: [String] = []
    private(set) var totpSetup: TotpSetup?
    private(set) var mfaChallenge: MfaChallenge?
    private(set) var phoneCodeExpiresAt: Date?

    /// Oturum kabuğunun modeli. `.authenticated` adımına geçerken **bir kez**
    /// kurulur; `RootView`'ın her çiziminde yeniden yaratılsaydı sekme seçimi
    /// ve şube tercihi her yeniden çizimde sıfırlanırdı.
    private(set) var session: AppSession?

    /// Ara token. `mfa` ve `tenant_select` adımlarında taşınır; hiçbir
    /// zaman kalıcı depoya yazılmaz — yarım oturumun sırrı diskte durmaz.
    private var challengeToken: String?

    /// Passkey teklifi yalnız parolayla girildiyse anlamlıdır.
    private var didUsePasswordLogin = false

    /// Girilen tanımlayıcının okunabilir hâli — parola ekranında gösterilir.
    var identifierSummary: String {
        identifierMode == .phone ? PhoneNumberField.pretty(phoneE164) : email
    }

    var canSubmitIdentifier: Bool {
        identifierMode == .phone ? !phoneE164.isEmpty : email.contains("@")
    }

    /// Sunucu alt sınırı 10 karakterdir; istemci aynı sınırı uygular.
    var canSubmitPassword: Bool { password.count >= 10 }

    var biometry: BiometryKind { BiometryKind.current }

    var offersPasskeyShortcut: Bool { PasskeyRegistry.hasEnrolledPasskey }

    // MARK: - Başlangıç

    func start() async {
        guard tokens.hasSession else {
            // Marka ekranının anlık yanıp sönmesini önle.
            try? await Task.sleep(for: .milliseconds(450))
            step = .identifier
            return
        }
        await loadProfileAndRoute()
    }

    // MARK: - Passkey ile giriş

    func signInWithPasskey() async {
        error = nil
        overlayMessage = "\(biometry.displayName) bekleniyor…"
        defer { overlayMessage = nil }

        do {
            let options = try await auth.passkeyAssertionOptions()
            let assertion = try await passkeys.assert(options: options)
            let response = try await auth.passkeyVerify(assertion, deviceLabel: DeviceLabel.current)
            didUsePasswordLogin = false
            try await handle(response.outcome())
        } catch {
            // Kullanıcı sheet'i kapattıysa hata göstermeyiz; sessizce dönülür.
            capture(error)
        }
    }

    // MARK: - Tanımlayıcı ve parola

    func submitIdentifier() {
        error = nil
        step = .password
    }

    func switchIdentifierMode() {
        error = nil
        identifierMode = identifierMode == .phone ? .email : .phone
    }

    func submitPassword() async {
        await perform {
            let response = try await self.auth.login(
                email: self.identifierMode == .email ? self.email : nil,
                phone: self.identifierMode == .phone ? self.phoneE164 : nil,
                password: self.password,
                deviceLabel: DeviceLabel.current
            )
            self.didUsePasswordLogin = true
            try await self.handle(response.outcome())
        }
    }

    // MARK: - Kiracı seçimi

    func selectTenant(_ tenant: TenantOption) async {
        guard let challengeToken else { return }
        await perform {
            let response = try await self.auth.selectTenant(
                challengeToken: challengeToken,
                tenantId: tenant.id
            )
            self.tokens.setTenant(tenant.id)
            try await self.handle(response.outcome())
        }
    }

    // MARK: - İkinci faktör

    func submitMfaCode() async {
        await submitSecondFactor(code: mfaCode)
    }

    func submitBackupCode() async {
        await submitSecondFactor(code: backupCode)
    }

    private func submitSecondFactor(code: String) async {
        guard let challengeToken else { return }
        await perform {
            let response = try await self.auth.verifyMfa(
                challengeToken: challengeToken,
                code: code,
                deviceLabel: DeviceLabel.current
            )
            try await self.handle(response.outcome())
        }
    }

    func useBackupCode() {
        error = nil
        mfaCode = ""
        step = .backupCode
    }

    func useAuthenticatorCode() {
        error = nil
        backupCode = ""
        step = .totp
    }

    // MARK: - TOTP kurulumu (giriş akışının içinde)

    private func beginTotpSetup() async {
        guard let challengeToken else { return }
        await perform {
            self.totpSetup = try await self.auth.totpSetup(challengeToken: challengeToken)
            self.step = .totpSetup
        }
    }

    func confirmTotpSetup() async {
        guard let challengeToken else { return }
        await perform {
            self.backupCodes = try await self.auth.totpEnable(
                challengeToken: challengeToken,
                code: self.totpSetupCode
            )
            self.totpSetupCode = ""
            self.step = .backupCodesDisplay
        }
    }

    /// Yedek kodlar gösterildikten sonra girişi tamamlamak için **yeni** bir
    /// kod gerekir: kurulumda kullanılan kod sunucuda yakıldı, tekrarı kabul
    /// edilmez (replay koruması).
    func finishBackupCodesDisplay() {
        mfaCode = ""
        step = .totp
    }

    // MARK: - Parola kurtarma

    func openForgotPassword() {
        error = nil
        // Telefonla girmiş olsa da kurtarma yolu e-postadır.
        forgotPasswordEmail = identifierMode == .email ? email : ""
        step = .forgotPasswordEmail
    }

    func submitForgotPassword() async {
        await perform {
            try await self.auth.forgotPassword(email: self.forgotPasswordEmail)
            // Sunucu, e-posta kayıtlı olsun ya da olmasın aynı yanıtı verir;
            // arayüz de ayrım yapmaz.
            self.step = .forgotPasswordSent
        }
    }

    // MARK: - Telefon doğrulama

    /// Profilde numara yoksa ekran giriş alanı gösterir.
    var needsPhoneEntry: Bool { profile?.user.phone == nil }

    /// Doğrulanacak numara: profildeki varsa o, yoksa kullanıcının girdiği.
    var verificationPhone: String? {
        if let existing = profile?.user.phone, !existing.isEmpty { return existing }
        return phoneToVerify.isEmpty ? nil : phoneToVerify
    }

    var canSubmitPhone: Bool { (verificationPhone?.count ?? 0) >= 12 }

    func sendPhoneCode() async {
        guard let phone = verificationPhone else { return }
        await perform {
            let started = try await self.auth.startPhoneVerification(phone: phone)
            self.phoneCodeExpiresAt = started.expiresAt
            // Sunucu numarayı E.164'e normalize eder; ekranda gösterilen
            // numaranın gönderilenle aynı olması için geri yazıyoruz.
            self.phoneToVerify = started.phone
        }
    }

    /// Numarayı değiştirmek için doğrulama adımının başına dön.
    func changePhoneNumber() {
        error = nil
        smsCode = ""
        phoneCodeExpiresAt = nil
    }

    func submitPhoneCode() async {
        await perform {
            _ = try await self.auth.verifyPhone(code: self.smsCode)
            self.smsCode = ""
            await self.loadProfileAndRoute()
        }
    }

    // MARK: - Şube seçimi

    func selectBranch(_ branch: BranchSummary) async {
        tokens.setBranch(branch.id)
        await offerPasskeyOrFinish()
    }

    // MARK: - Passkey kaydı

    func enrollPasskey() async {
        error = nil
        overlayMessage = "\(biometry.displayName) bekleniyor…"
        defer { overlayMessage = nil }

        do {
            let options = try await auth.passkeyRegistrationOptions()
            let registration = try await passkeys.register(options: options)
            try await auth.registerPasskey(registration, deviceLabel: DeviceLabel.current)
            PasskeyRegistry.hasEnrolledPasskey = true
            finishAuthentication()
        } catch {
            capture(error)
        }
    }

    func skipPasskeyEnrollment() {
        finishAuthentication()
    }

    // MARK: - Çıkış

    func logout() async {
        try? await auth.logout()
        tokens.clear()
        resetInputs()
        profile = nil
        session = nil
        step = .identifier
    }

    /// Geliştirici senaryosu değiştiğinde akışı baştan başlatır.
    /// Oturumu da düşürür: eldeki token artık başka bir senaryoya aittir.
    func resetForScenarioChange() {
        tokens.clear()
        resetInputs()
        profile = nil
        session = nil
        error = nil
        phoneE164 = ""
        email = ""
        identifierMode = .phone
        step = .identifier
    }

    // MARK: - Gezinme

    /// Geri adımı. Parola/2FA adımlarından geri dönmek tanımlayıcıyı sıfırlar:
    /// yarım kimlik durumunda takılı kalmayı önler.
    func goBack() {
        error = nil
        switch step {
        case .password:
            password = ""
            step = .identifier
        case .totp, .backupCode, .totpSetup:
            resetChallenge()
            step = .identifier
        case .forgotPasswordEmail:
            step = .password
        case .forgotPasswordSent:
            resetInputs()
            step = .identifier
        default:
            step = .identifier
        }
    }

    var canGoBack: Bool {
        switch step {
        case .password, .totp, .backupCode, .totpSetup,
             .forgotPasswordEmail, .forgotPasswordSent:
            true
        default:
            false
        }
    }

    func dismissError() {
        error = nil
    }

    // MARK: - Yönlendirme

    private func handle(_ outcome: LoginOutcome) async throws {
        switch outcome {
        case .success(let tokenPair):
            tokens.save(tokenPair)
            resetChallenge()
            await loadProfileAndRoute()

        case .needsTenantSelection(let token, let options):
            challengeToken = token
            tenants = options
            step = .tenantSelect

        case .needsMfa(let token, let challenge):
            challengeToken = token
            mfaChallenge = challenge
            if challenge.configured {
                step = .totp
            } else {
                // Politika 2FA'yı zorunlu kılmış ama kullanıcı kurmamış.
                // Kurulum ekranı olmadan mobilde tamamen kilitli kalırdı.
                await beginTotpSetup()
            }
        }
    }

    private func loadProfileAndRoute() async {
        await perform {
            let me = try await self.auth.me()
            self.profile = me
            self.tokens.setTenant(me.tenantId)

            // Doğrulanmamış numara giriş tanımlayıcısı olamaz — önce doğrulanır.
            guard me.user.phoneVerified else {
                self.phoneCodeExpiresAt = nil
                self.step = .phoneVerification
                return
            }

            try await self.routeToBranchOrFinish(me)
        }
    }

    private func routeToBranchOrFinish(_ me: MeResponse) async throws {
        let all = try await auth.branches()
        // Kiracı kapsamlı rol tüm şubeleri görür; değilse yalnız üyesi olduğu şubeler.
        let visible = me.tenantWide ? all : all.filter { me.branchIds.contains($0.id) }
        branches = visible

        if visible.count > 1, tokens.branchId == nil {
            step = .branchSelect
        } else {
            // Bu yol oturum GERİ YÜKLENİRKEN de geçiliyor. Koşulsuz
            // `setBranch(visible.first)` yazmak, kullanıcının seçtiği şubeyi
            // her açılışta listenin ilkiyle eziyordu — çok şubeli bir klinik
            // uygulamayı her açtığında yanlış şubenin takvimine bakıyordu.
            //
            // Kayıtlı şube artık **erişilebilir değilse** yine de düzeltilir:
            // üyeliği alınmış bir şube kimliğiyle atılan her istek
            // `403 BRANCH_FORBIDDEN` alırdı.
            let saved = tokens.branchId
            if saved == nil || !visible.contains(where: { $0.id == saved }) {
                tokens.setBranch(visible.first?.id)
            }
            await offerPasskeyOrFinish()
        }
    }

    /// Parolayla girildiyse ve bu cihazda passkey yoksa bir kez teklif edilir.
    private func offerPasskeyOrFinish() async {
        let eligible = didUsePasswordLogin
            && !PasskeyRegistry.hasEnrolledPasskey
            && profile?.user.hasPassword == true
        if eligible {
            step = .passkeyEnrollOffer
        } else {
            finishAuthentication()
        }
    }

    /// Kabuğa geçiş. Oturum modeli burada, tek yerde kurulur.
    private func finishAuthentication() {
        guard let profile else {
            // `/me` olmadan kabuğa geçilemez: izinler ve şubeler oradan gelir.
            step = .identifier
            return
        }
        session = AppSession(profile: profile, branches: branches, services: services)
        step = .authenticated
    }

    // MARK: - Yardımcılar

    /// Yükleme durumunu ve hata yakalamayı tek yerde toplar.
    private func perform(_ work: @escaping () async throws -> Void) async {
        isBusy = true
        error = nil
        defer { isBusy = false }
        do {
            try await work()
        } catch {
            capture(error)
        }
    }

    private func capture(_ raised: any Error) {
        let authError = raised as? AuthError ?? .network
        guard !authError.isSilent else { return }

        if authError.invalidatesSession {
            tokens.clear()
            resetInputs()
            session = nil
            step = .identifier
        }
        error = authError
    }

    private func resetChallenge() {
        challengeToken = nil
        mfaChallenge = nil
        totpSetup = nil
        mfaCode = ""
        backupCode = ""
        totpSetupCode = ""
    }

    private func resetInputs() {
        password = ""
        smsCode = ""
        phoneToVerify = ""
        forgotPasswordEmail = ""
        tenants = []
        branches = []
        backupCodes = []
        didUsePasswordLogin = false
        resetChallenge()
    }
}
