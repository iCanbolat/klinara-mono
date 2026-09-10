package com.klinara.android.services.crm

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.formatting.SearchText
import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.ProblemDetails
import kotlinx.coroutines.delay
import kotlin.random.Random

class MockCustomerService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
) : CustomerService {
    var failing: Boolean = false

    override suspend fun get(id: String): Customer {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()

        val row =
            MockCustomers.byId(id)
                ?: throw ApiError.Problem(
                    ProblemDetails(
                        code = ApiErrorCode.NOT_FOUND,
                        title = "Müşteri bulunamadı",
                        status = HTTP_NOT_FOUND,
                    ),
                )
        return Customer(id = row.id, fullName = row.fullName, phone = row.phone)
    }

    override suspend fun search(query: String): List<Customer> {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()

        val term = query.trim()
        if (term.isEmpty()) return emptyList()
        // Türkçe katlama ve rakam eşleştirme ÜRETİM yardımcılarıyla: mock'ta "Ismail"
        // ile "İsmail"i ayrı sayan bir arama, ekranı yanlış sürerdi.
        return MockCustomers.ALL
            .filter { SearchText.matches(it.fullName, term) || SearchText.matchesDigits(it.phone, term) }
            .map { Customer(id = it.id, fullName = it.fullName, phone = it.phone) }
    }

    private companion object {
        const val MIN_LATENCY_MILLIS = 120L
        const val MAX_LATENCY_MILLIS = 400L
        const val HTTP_NOT_FOUND = 404
    }
}
