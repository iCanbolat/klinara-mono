package com.klinara.android.services.auth

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

@Serializable
private data class LoginBody(
    val email: String? = null,
    val phone: String? = null,
    val password: String,
    val deviceLabel: String,
)

@Serializable
private data class SelectTenantBody(
    val challengeToken: String,
    val tenantId: String,
)

@Serializable
private data class VerifyMfaBody(
    val challengeToken: String,
    val code: String,
    val deviceLabel: String,
)

@Serializable
private data class TotpCodeBody(val code: String)

@Serializable
private data class BackupCodesResponse(val backupCodes: List<String> = emptyList())

@Serializable
private data class StartPhoneBody(val phone: String)

@Serializable
private data class VerifyPhoneBody(val code: String)

@Serializable
private data class ForgotPasswordBody(val email: String)

/** `{ response: <webauthn json>, deviceLabel }` — RegisterPasskeyDto / VerifyPasskeyDto. */
private fun webAuthnEnvelope(
    responseJson: String,
    deviceLabel: String,
): RequestBodyPayload {
    val response = KlinaraJson.parseToJsonElement(responseJson).jsonObject
    val envelope: JsonObject =
        buildJsonObject {
            put("response", response)
            put("deviceLabel", deviceLabel)
        }
    return RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), envelope))
}

private fun body(json: String) = RequestBodyPayload(json)

class LiveAuthService internal constructor(
    private val client: ApiClient,
) : AuthService {
    override suspend fun login(
        email: String?,
        phone: String?,
        password: String,
        deviceLabel: String,
    ): LoginResponse =
        client.send(
            ApiRequest.post(
                "auth/login",
                body = body(KlinaraJson.encodeToString(LoginBody(email, phone, password, deviceLabel))),
                requiresAuth = false,
            ),
        )

    override suspend fun selectTenant(
        challengeToken: String,
        tenantId: String,
    ): LoginResponse =
        client.send(
            ApiRequest.post(
                "auth/tenant",
                body = body(KlinaraJson.encodeToString(SelectTenantBody(challengeToken, tenantId))),
                requiresAuth = false,
            ),
        )

    override suspend fun verifyMfa(
        challengeToken: String,
        code: String,
        deviceLabel: String,
    ): LoginResponse =
        client.send(
            ApiRequest.post(
                "auth/2fa/verify",
                body = body(KlinaraJson.encodeToString(VerifyMfaBody(challengeToken, code, deviceLabel))),
                requiresAuth = false,
            ),
        )

    override suspend fun totpSetup(challengeToken: String): TotpSetup =
        client.send(
            ApiRequest.post("auth/2fa/setup", requiresAuth = false, bearerOverride = challengeToken),
        )

    override suspend fun totpEnable(
        challengeToken: String,
        code: String,
    ): List<String> =
        client
            .send<BackupCodesResponse>(
                ApiRequest.post(
                    "auth/2fa/enable",
                    body = body(KlinaraJson.encodeToString(TotpCodeBody(code))),
                    requiresAuth = false,
                    bearerOverride = challengeToken,
                ),
            ).backupCodes

    override suspend fun me(): MeResponse = client.send(ApiRequest.get("me"))

    override suspend fun branches(): List<BranchSummary> =
        client.send<ListEnvelope<BranchSummary>>(ApiRequest.get("branches")).data

    override suspend fun startPhoneVerification(phone: String): PhoneVerificationStarted =
        client.send(
            ApiRequest.post("auth/phone/start", body = body(KlinaraJson.encodeToString(StartPhoneBody(phone)))),
        )

    override suspend fun verifyPhone(code: String): PhoneVerified =
        client.send(
            ApiRequest.post("auth/phone/verify", body = body(KlinaraJson.encodeToString(VerifyPhoneBody(code)))),
        )

    override suspend fun forgotPassword(email: String) {
        client.sendVoid(
            ApiRequest.post(
                "auth/password/forgot",
                body = body(KlinaraJson.encodeToString(ForgotPasswordBody(email))),
                requiresAuth = false,
            ),
        )
    }

    override suspend fun logout() {
        client.sendVoid(ApiRequest.post("auth/logout"))
    }

    override suspend fun totpStatus(): TotpStatus = client.send(ApiRequest.get("auth/2fa"))

    override suspend fun passkeys(): List<PasskeySummary> =
        client.send<ListEnvelope<PasskeySummary>>(ApiRequest.get("auth/passkeys")).data

    override suspend fun deletePasskey(id: String) {
        client.sendVoid(ApiRequest.delete("auth/passkeys/$id"))
    }

    override suspend fun passkeyAssertionOptions(): String =
        client
            .send<JsonObject>(ApiRequest.post("auth/passkey/options", requiresAuth = false))
            .let { KlinaraJson.encodeToString(JsonObject.serializer(), it) }

    override suspend fun passkeyVerify(
        responseJson: String,
        deviceLabel: String,
    ): LoginResponse =
        client.send(
            ApiRequest.post(
                "auth/passkey/verify",
                body = webAuthnEnvelope(responseJson, deviceLabel),
                requiresAuth = false,
            ),
        )

    override suspend fun passkeyRegistrationOptions(): String =
        client
            .send<JsonObject>(ApiRequest.post("auth/passkeys/register/options"))
            .let { KlinaraJson.encodeToString(JsonObject.serializer(), it) }

    override suspend fun registerPasskey(
        responseJson: String,
        deviceLabel: String,
    ) {
        client.sendVoid(
            ApiRequest.post("auth/passkeys/register", body = webAuthnEnvelope(responseJson, deviceLabel)),
        )
    }
}
