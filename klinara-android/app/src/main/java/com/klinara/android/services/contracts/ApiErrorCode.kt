// ÜRETİLMİŞTİR — ELLE DÜZENLEMEYİN.
//
// Kaynak: packages/shared/src/{error-codes,permissions}.ts
// Yeniden üretmek için: pnpm gen:contracts
//
// Bu dosyayı elle değiştirmek, sunucu sözleşmesiyle istemciyi sessizce ayrıştırır.

package com.klinara.android.services.contracts

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * RFC 9457 yanıtlarındaki `code` alanı. İstemci BU değerlere göre dallanır;
 * `title`/`detail` insan içindir ve serbestçe değişebilir.
 *
 * Tanınmayan bir kod [UNKNOWN]'a düşer, çözümlemeyi KIRMAZ: sunucu yeni bir kod
 * eklediğinde eski istemciler çökmemeli, yalnız o kodu genel hata gibi göstermeli.
 */
@Serializable(with = ApiErrorCodeSerializer::class)
enum class ApiErrorCode(val wire: String) {
    VALIDATION_FAILED("VALIDATION_FAILED"),
    NOT_FOUND("NOT_FOUND"),
    INTERNAL_ERROR("INTERNAL_ERROR"),
    RATE_LIMITED("RATE_LIMITED"),
    SERVICE_UNAVAILABLE("SERVICE_UNAVAILABLE"),
    UNAUTHENTICATED("UNAUTHENTICATED"),
    TOKEN_EXPIRED("TOKEN_EXPIRED"),
    TOKEN_INVALID("TOKEN_INVALID"),
    FORBIDDEN("FORBIDDEN"),
    BRANCH_FORBIDDEN("BRANCH_FORBIDDEN"),
    INVALID_CREDENTIALS("INVALID_CREDENTIALS"),
    ACCOUNT_LOCKED("ACCOUNT_LOCKED"),
    ACCOUNT_DISABLED("ACCOUNT_DISABLED"),
    TENANT_SELECTION_REQUIRED("TENANT_SELECTION_REQUIRED"),
    MFA_REQUIRED("MFA_REQUIRED"),
    MFA_INVALID("MFA_INVALID"),
    PHONE_NOT_VERIFIED("PHONE_NOT_VERIFIED"),
    PHONE_IN_USE("PHONE_IN_USE"),
    VERIFICATION_FAILED("VERIFICATION_FAILED"),
    PASSKEY_INVALID("PASSKEY_INVALID"),
    CREDENTIAL_REQUIRED("CREDENTIAL_REQUIRED"),
    INVITATION_INVALID("INVITATION_INVALID"),
    ROLE_ESCALATION("ROLE_ESCALATION"),
    SLOT_CONFLICT("SLOT_CONFLICT"),
    RESOURCE_UNAVAILABLE("RESOURCE_UNAVAILABLE"),
    OUTSIDE_WORKING_HOURS("OUTSIDE_WORKING_HOURS"),
    INVALID_STATUS_TRANSITION("INVALID_STATUS_TRANSITION"),
    PACKAGE_EXHAUSTED("PACKAGE_EXHAUSTED"),
    PACKAGE_EXPIRED("PACKAGE_EXPIRED"),
    CONTRAINDICATION_BLOCK("CONTRAINDICATION_BLOCK"),
    CONSENT_REQUIRED("CONSENT_REQUIRED"),
    PAYMENT_EXCEEDS_BALANCE("PAYMENT_EXCEEDS_BALANCE"),
    DISCOUNT_INVALID("DISCOUNT_INVALID"),
    CASH_SESSION_REQUIRED("CASH_SESSION_REQUIRED"),
    CASH_SESSION_ALREADY_OPEN("CASH_SESSION_ALREADY_OPEN"),
    PERIOD_CLOSED("PERIOD_CLOSED"),
    IDEMPOTENCY_CONFLICT("IDEMPOTENCY_CONFLICT"),
    VERSION_CONFLICT("VERSION_CONFLICT"),
    OPT_OUT("OPT_OUT"),
    TEMPLATE_INVALID("TEMPLATE_INVALID"),
    CHANNEL_NOT_CONFIGURED("CHANNEL_NOT_CONFIGURED"),
    WHATSAPP_NOT_CONFIGURED("WHATSAPP_NOT_CONFIGURED"),
    WHATSAPP_TEMPLATE_NOT_APPROVED("WHATSAPP_TEMPLATE_NOT_APPROVED"),
    WHATSAPP_INVALID_RECIPIENT("WHATSAPP_INVALID_RECIPIENT"),
    WHATSAPP_WINDOW_CLOSED("WHATSAPP_WINDOW_CLOSED"),
    WHATSAPP_RATE_LIMITED("WHATSAPP_RATE_LIMITED"),
    HOST_TAKEN("HOST_TAKEN"),
    DOMAIN_VERIFICATION_FAILED("DOMAIN_VERIFICATION_FAILED"),
    SITE_NOT_PUBLISHED("SITE_NOT_PUBLISHED"),
    CONTENT_INVALID("CONTENT_INVALID"),
    SLOT_TOKEN_INVALID("SLOT_TOKEN_INVALID"),
    STAFF_REF_INVALID("STAFF_REF_INVALID"),
    HOLD_INVALID("HOLD_INVALID"),
    HOLD_EXPIRED("HOLD_EXPIRED"),
    HOLD_LIMIT_REACHED("HOLD_LIMIT_REACHED"),
    OTP_REQUIRED("OTP_REQUIRED"),
    OTP_LOCKED("OTP_LOCKED"),
    BOOKING_TOKEN_INVALID("BOOKING_TOKEN_INVALID"),
    CANCEL_WINDOW_CLOSED("CANCEL_WINDOW_CLOSED"),
    TENANT_CONTEXT_MISSING("TENANT_CONTEXT_MISSING"),
    CONFLICT("CONFLICT"),

    /** Sunucudan tanınmayan bir kod geldi. Sözleşmede yoktur, üretilmez. */
    UNKNOWN("UNKNOWN"),
    ;

    companion object {
        private val byWire = entries.associateBy(ApiErrorCode::wire)

        fun from(raw: String): ApiErrorCode = byWire[raw] ?: UNKNOWN
    }
}

/**
 * kotlinx.serialization'ın bilinmeyen enum değeri için yerleşik bir yedeği yok
 * (`coerceInputValues` yalnız *property* varsayılanıyla çalışır, değer düzeyinde
 * değil), bu yüzden özel serializer doğru mekanizmadır — geçici çözüm değil.
 */
object ApiErrorCodeSerializer : KSerializer<ApiErrorCode> {
    override val descriptor = PrimitiveSerialDescriptor("ApiErrorCode", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): ApiErrorCode = ApiErrorCode.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: ApiErrorCode,
    ) = encoder.encodeString(value.wire)
}
