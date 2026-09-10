package com.klinara.android.services.networking

import com.klinara.android.services.contracts.ApiErrorCode

/**
 * Ekranların gördüğü tek hata tipi.
 *
 * **Ekranlar HTTP durum kodu görmez.** 2xx dışı her yanıt burada `code` enum'una
 * indirgenir; bir ekranın `if (status == 409)` yazması, sözleşmenin iki yerde
 * yaşaması demektir.
 */
sealed class ApiError(
    override val cause: Throwable? = null,
) : Exception(cause) {
    /** Sunucu RFC 9457 gövdesiyle cevapladı. */
    data class Problem(val problem: ProblemDetails) : ApiError()

    /**
     * Bağlantı kurulamadı, zaman aşımı, DNS. İptal DEĞİL.
     *
     * Taşıma istisnası [cause] olarak KORUNUR: zaman aşımı mı, DNS mi, bağlantı
     * sıfırlaması mı — bunu kaybetmek üretimde teşhisi imkânsız kılar. Kullanıcıya
     * yine tek bir cümle gösterilir.
     */
    class Network(cause: Throwable? = null) : ApiError(cause)

    /** 2xx geldi ama gövde beklenen şemaya uymuyor. Bu bir sözleşme hatasıdır. */
    class MalformedResponse(val reason: String, cause: Throwable? = null) : ApiError(cause)

    /** İmzalı yükleme başarısız. Yenileme denenmez — imza zaten yetkidir. */
    class UploadFailed(val httpStatus: Int) : ApiError()

    val code: ApiErrorCode
        get() = (this as? Problem)?.problem?.code ?: ApiErrorCode.UNKNOWN

    val status: Int
        get() =
            when (this) {
                is Problem -> problem.status
                is UploadFailed -> httpStatus
                else -> 0
            }

    /**
     * Kullanıcıya gösterilecek Türkçe metin.
     *
     * Sunucunun `title`/`detail`'i genel amaçlıdır; istemci bağlamı bildiği için
     * daha iyi bir cümle kurabilir. Bilmediği kodlarda sunucununkine düşer.
     */
    val displayMessage: String
        get() =
            when (this) {
                is Network -> "Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin."
                is MalformedResponse -> "Sunucudan beklenmeyen bir yanıt geldi."
                is UploadFailed -> "Dosya yüklenemedi. Lütfen tekrar deneyin."
                is Problem -> problemMessage()
            }

    /**
     * Kod → Türkçe metin. Bir `when` zinciri değil TABLO: bu bir arama tablosudur,
     * denetim akışı değil; yeni bir kod eklemek bir satır eklemektir.
     *
     * Tabloda olmayan kodlarda sunucunun `detail`/`title`'ına düşülür.
     */
    private fun Problem.problemMessage(): String =
        MESSAGES[problem.code]
            ?: problem.detail
            ?: problem.title.ifEmpty { GENERIC_MESSAGE }

    /**
     * Destek referansı YALNIZ sunucu tarafı hatalarda gösterilir. Kullanıcı hatasında
     * bir vaka numarası vermek yardım değil, gürültüdür.
     */
    val supportReference: String?
        get() =
            (this as? Problem)
                ?.takeIf {
                    it.problem.code in
                        setOf(
                            ApiErrorCode.INTERNAL_ERROR,
                            ApiErrorCode.SERVICE_UNAVAILABLE,
                            ApiErrorCode.UNKNOWN,
                        )
                }?.problem?.requestId

    /** Aynı isteği tekrar denemek anlamlı mı? */
    val isRetryable: Boolean
        get() =
            when (this) {
                is Network -> true
                is Problem ->
                    problem.code in
                        setOf(
                            ApiErrorCode.SERVICE_UNAVAILABLE,
                            ApiErrorCode.RATE_LIMITED,
                            ApiErrorCode.INTERNAL_ERROR,
                        )
                else -> false
            }

    /**
     * Oturumu düşürmeli mi?
     *
     * YALNIZ token hataları. `FORBIDDEN` oturumu düşürmez — kullanıcı giriş yapmıştır,
     * sadece o işleme yetkisi yoktur; onu çıkışa atmak kullanıcıyı cezalandırmaktır.
     */
    val invalidatesSession: Boolean
        get() = code == ApiErrorCode.TOKEN_EXPIRED || code == ApiErrorCode.TOKEN_INVALID

    /** Kullanıcının kendi iptali gibi durumlar ekranda hata olarak gösterilmez. */
    val isSilent: Boolean
        get() = false

    val slotConflicts: List<SlotConflict>
        get() = (this as? Problem)?.problem?.conflicts.orEmpty()

    val slotSuggestions: List<SlotSuggestion>
        get() = (this as? Problem)?.problem?.suggestions.orEmpty()

    /** 428 — sunucu bir ön koşul bekliyor (örn. onam). */
    val isPreconditionRequired: Boolean
        get() = status == HTTP_PRECONDITION_REQUIRED

    /** Alan yolu → ilk hata mesajı. Form alanlarının altına basılır. */
    val fieldErrors: Map<String, String>
        get() =
            (this as? Problem)
                ?.problem
                ?.errors
                .orEmpty()
                .groupBy { it.path }
                .mapValues { (_, errors) -> errors.first().message }

    /** Hata tamamen alan bazlıysa ekran düzeyi afiş gösterilmez — çift mesaj olur. */
    val isFieldScoped: Boolean
        get() = code == ApiErrorCode.VALIDATION_FAILED && fieldErrors.isNotEmpty()

    private companion object {
        const val HTTP_PRECONDITION_REQUIRED = 428
        const val GENERIC_MESSAGE = "Beklenmeyen bir hata oluştu."

        val MESSAGES: Map<ApiErrorCode, String> =
            mapOf(
                ApiErrorCode.INVALID_CREDENTIALS to "Girdiğiniz bilgiler hatalı.",
                ApiErrorCode.ACCOUNT_LOCKED to
                    "Çok fazla hatalı deneme yapıldı. Hesabınız geçici olarak kilitlendi.",
                ApiErrorCode.ACCOUNT_DISABLED to "Hesabınız devre dışı. Yöneticinizle görüşün.",
                ApiErrorCode.MFA_INVALID to "Doğrulama kodu hatalı.",
                ApiErrorCode.VERIFICATION_FAILED to "Kod hatalı ya da süresi dolmuş.",
                ApiErrorCode.PHONE_NOT_VERIFIED to "Telefon numaranız doğrulanmamış.",
                ApiErrorCode.PHONE_IN_USE to "Bu telefon numarası başka bir hesapta kayıtlı.",
                ApiErrorCode.PASSKEY_INVALID to "Passkey doğrulanamadı.",
                ApiErrorCode.UNAUTHENTICATED to "Oturumunuz sona erdi. Lütfen tekrar giriş yapın.",
                ApiErrorCode.TOKEN_EXPIRED to "Oturumunuz sona erdi. Lütfen tekrar giriş yapın.",
                ApiErrorCode.TOKEN_INVALID to "Oturumunuz sona erdi. Lütfen tekrar giriş yapın.",
                ApiErrorCode.FORBIDDEN to "Bu işlem için yetkiniz yok.",
                ApiErrorCode.BRANCH_FORBIDDEN to "Bu şubeye erişiminiz yok.",
                ApiErrorCode.RATE_LIMITED to "Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.",
                ApiErrorCode.SERVICE_UNAVAILABLE to
                    "Servis şu anda kullanılamıyor. Birazdan tekrar deneyin.",
                ApiErrorCode.INTERNAL_ERROR to GENERIC_MESSAGE,
                ApiErrorCode.NOT_FOUND to "Kayıt bulunamadı.",
                ApiErrorCode.VERSION_CONFLICT to
                    "Bu kayıt siz bakarken değişti. Sayfayı yenileyip tekrar deneyin.",
                ApiErrorCode.SLOT_CONFLICT to "Bu saat dolu.",
                ApiErrorCode.OUTSIDE_WORKING_HOURS to "Bu saat çalışma saatleri dışında.",
            )
    }
}
