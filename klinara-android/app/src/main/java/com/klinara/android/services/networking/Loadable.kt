package com.klinara.android.services.networking

/**
 * Bir bölümün yükleme durumu.
 *
 * Ekranın tamamı için tek bir `isLoading` yeterli DEĞİL: bir ekran birden çok
 * çağrıdan beslenir ve biri düşerken diğeri gelmiş olabilir (A2.2'de profil, A3'te
 * takvim + personel listesi). Tek bayrak, gelmiş olan veriyi de gizlerdi.
 *
 * A2.2'de `features/profile` içinde doğdu; A3 ikinci tüketici oldu ve buraya taşındı.
 * İki pakette iki kopya, ikinci kopyanın er geç ayrışması demekti.
 */
sealed interface Loadable<out T> {
    data object Loading : Loadable<Nothing>

    data class Loaded<T>(val value: T) : Loadable<T>

    data class Failed(val message: String, val isRetryable: Boolean) : Loadable<Nothing>

    /** Yüklenmişse değeri, değilse null. Ekranlar `when` yazmadan okuyabilsin diye. */
    val valueOrNull: T? get() = (this as? Loaded)?.value

    companion object {
        /**
         * `ApiError` → `Failed` eşlemesi TEK yerde.
         *
         * Her çağrı yerinde `catch (e: ApiError) { Failed(e.displayMessage, e.isRetryable) }`
         * yazmak, bir gün birinin `isRetryable`'ı unutması ve o bölümde "Tekrar dene"
         * düğmesinin sessizce kaybolması demekti.
         */
        fun failed(error: ApiError): Failed = Failed(error.displayMessage, error.isRetryable)

        /** Çağrıyı sarar; `ApiError` dışındaki istisnalar yukarı geçer (gerçek hatalar gizlenmez). */
        inline fun <T> of(block: () -> T): Loadable<T> =
            try {
                Loaded(block())
            } catch (error: ApiError) {
                failed(error)
            }
    }
}
