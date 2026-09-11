package com.klinara.android.services.mock

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.FieldError
import com.klinara.android.services.networking.ProblemDetails

/**
 * Mock servislerin PAYLAŞTIĞI hata fabrikası.
 *
 * Her mock kendi `ProblemDetails`ini kurarsa aynı hata iki serviste iki farklı `code`
 * ile çıkar ve ekran biri için doğru, diğeri için yanlış mesaj gösterir. Kimlikleri
 * `MockIds`te toplamanın gerekçesi neyse bunun gerekçesi de o.
 *
 * iOS `MockErrors` paritesi.
 */
object MockErrors {
    fun notFound(what: String): ApiError.Problem =
        problem(ApiErrorCode.NOT_FOUND, "$what bulunamadı", HTTP_NOT_FOUND)

    fun forbidden(detail: String): ApiError.Problem =
        problem(ApiErrorCode.FORBIDDEN, "Yetkiniz yok", HTTP_FORBIDDEN, detail)

    fun conflict(
        title: String,
        detail: String? = null,
    ): ApiError.Problem = problem(ApiErrorCode.CONFLICT, title, HTTP_CONFLICT, detail)

    /** Sürüm çakışması — iyimser kilit. Notlarda `PATCH` bayat sürümle gelirse. */
    fun versionConflict(): ApiError.Problem =
        problem(
            ApiErrorCode.VERSION_CONFLICT,
            "Kayıt başkası tarafından değiştirildi",
            HTTP_CONFLICT,
            "Bu kaydı siz açtıktan sonra başka biri güncelledi.",
        )

    /** Paket hakkı bu işlem için yetersiz — kalan hak eksiye inemez (A5). */
    fun packageExhausted(): ApiError.Problem =
        problem(
            ApiErrorCode.PACKAGE_EXHAUSTED,
            "Paket hakkı yetersiz",
            HTTP_CONFLICT,
            "Kalan hak bu işlem için yeterli değil.",
        )

    /** Paket süresi dolmuş ya da kapatılmış (iade/devir) — tüketilemez (A5). */
    fun packageExpired(): ApiError.Problem =
        problem(
            ApiErrorCode.PACKAGE_EXPIRED,
            "Paket kullanılamaz",
            HTTP_CONFLICT,
            "Paketin süresi dolmuş ya da paket kapatılmış.",
        )

    /**
     * Alan bazlı doğrulama hatası.
     *
     * `path` sunucununkiyle **birebir** olmalı: ekran mesajı `FieldError.path`
     * üzerinden ilgili alanın altına yazıyor ve uyduruk bir yol, mesajın sessizce
     * hiçbir alana düşmemesi demek.
     */
    fun validation(
        path: String,
        message: String,
    ): ApiError.Problem =
        ApiError.Problem(
            ProblemDetails(
                code = ApiErrorCode.VALIDATION_FAILED,
                title = "Doğrulama hatası",
                status = HTTP_BAD_REQUEST,
                errors = listOf(FieldError(path = path, message = message)),
            ),
        )

    /** Kod ve durumu doğrudan verilen sorun — A8'in bildirim/WhatsApp kodları için. */
    fun problem(
        code: ApiErrorCode,
        title: String,
        status: Int,
        detail: String? = null,
    ): ApiError.Problem =
        ApiError.Problem(ProblemDetails(code = code, title = title, detail = detail, status = status))

    const val HTTP_BAD_REQUEST = 400
    const val HTTP_UNPROCESSABLE = 422
    const val HTTP_SERVICE_UNAVAILABLE = 503
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404
    private const val HTTP_CONFLICT = 409
}
