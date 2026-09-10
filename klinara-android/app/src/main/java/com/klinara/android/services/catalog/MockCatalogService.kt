package com.klinara.android.services.catalog

import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.delay
import kotlin.random.Random

/**
 * Mock hizmet kataloğu.
 *
 * Kimlikler ve süreler [MockIds] ile `MockBookingSeed`'in şablonlarıyla **aynı**:
 * tohumdaki bir randevunun hizmeti katalogda bulunamazsa rezervasyon formu var olan bir
 * randevuyu erteleyemez.
 */
class MockCatalogService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
) : CatalogService {
    var failing: Boolean = false

    override suspend fun services(): List<ClinicService> {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
        return ALL
    }

    companion object {
        val ALL: List<ClinicService> =
            listOf(
                service(MockIds.SERVICE_SKIN_CARE, "Cilt bakımı", minutes = 60, price = 90_000),
                service(MockIds.SERVICE_LASER, "Lazer epilasyon", minutes = 45, price = 145_000),
                service(MockIds.SERVICE_FILLER, "Dolgu", minutes = 90, price = 480_000),
                service(MockIds.SERVICE_CHECKUP, "Kontrol", minutes = 30, price = 0),
                // Pasif bir hizmet BİLEREK: form pasifleri gizliyor ve bu ancak
                // katalogda bir pasif kayıt varsa sürülebilir.
                service(MockIds.SERVICE_MASK, "Maske", minutes = 30, price = 35_000, isActive = false),
            )

        private const val MIN_LATENCY_MILLIS = 120L
        private const val MAX_LATENCY_MILLIS = 400L
        private const val BUFFER_BEFORE = 5
        private const val BUFFER_AFTER = 10
        private const val VAT_TWENTY = 2000

        private fun service(
            id: String,
            name: String,
            minutes: Int,
            price: Long,
            isActive: Boolean = true,
        ) = ClinicService(
            id = id,
            categoryId = "ca7e0000-0000-4000-8000-000000000001",
            name = name,
            durationMinutes = minutes,
            bufferBeforeMinutes = BUFFER_BEFORE,
            bufferAfterMinutes = BUFFER_AFTER,
            priceMinor = price,
            vatRateBasisPoints = VAT_TWENTY,
            isActive = isActive,
        )
    }
}
