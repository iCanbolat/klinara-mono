package com.klinara.android.features.customers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.designsystem.components.PhoneNumber
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.networking.Loadable

/**
 * Müşteri listesi — Müşteriler sekmesinin kökü.
 *
 * `KlinaraScreen` `scrollable = false` ile kuruluyor: içeride bir `LazyColumn` var ve
 * bir kaydırıcıyı başka bir kaydırıcının içine koymak Compose'da ölçüm hatası verir.
 * `CalendarHomeScreen` hafta ızgarası için aynısını yapıyor.
 */
@Composable
fun CustomerListScreen(
    session: AppSession,
    container: ServiceContainer,
    onSelectCustomer: (String) -> Unit,
    modifier: Modifier = Modifier,
    /** `customer:write` yoksa çağıran null geçer ve düğme HİÇ çizilmez (§7.4). */
    onCreateCustomer: (() -> Unit)? = null,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    // Sekme izinle kapılı ama ekran kendi kapısını da tutar: bir gün başka bir yerden
    // (derin bağlantı) açılırsa yetkisiz kullanıcıya liste çizilmemeli.
    if (!session.can(Permissions.CUSTOMER_READ)) {
        KlinaraScreen(title = "Müşteriler", modifier = modifier, trailing = trailing) {
            EmptyStateView(
                title = "Müşterilere erişiminiz yok",
                message = "Rolünüz müşteri kayıtlarını görüntülemiyor. Yöneticinizle görüşebilirsiniz.",
                icon = Icons.Filled.Person,
            )
        }
        return
    }

    val viewModel: CustomerListViewModel =
        viewModel(
            key = "customers-${session.profile.user.id}",
            factory = CustomerListViewModel.factory(container),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()

    // Şube kuşağına BAĞLANMAZ: müşteri KİRACI kapsamlıdır ve şube değişimi listeyi
    // bayatlatmaz. Takvimin aksine burada `branchGeneration` dinlemek, her şube
    // değişiminde 10 bin kayıtlık bir listeyi sebepsiz yeniden çekmek olurdu.
    LaunchedEffect(Unit) { viewModel.load() }

    KlinaraScreen(
        title = "Müşteriler",
        modifier = modifier,
        scrollable = false,
        contentPadding = PaddingValues(0.dp),
        trailing = trailing,
    ) {
        KlinaraTextField(
            label = "Ara",
            value = state.term,
            onValueChange = viewModel::search,
            placeholder = "Ad veya telefon",
            modifier = Modifier.padding(horizontal = KlinaraMetrics.screenInset),
        )

        onCreateCustomer?.let { onCreate ->
            KlinaraButton(
                title = "Yeni müşteri",
                onClick = onCreate,
                kind = KlinaraButtonKind.Secondary,
                modifier = Modifier.fillMaxWidth().padding(horizontal = KlinaraMetrics.screenInset),
            )
        }

        CustomerListBody(
            state = state,
            onSelectCustomer = onSelectCustomer,
            onRetry = if (state.isSearching) viewModel::retrySearch else viewModel::reload,
            onLoadMore = viewModel::loadMore,
        )
    }
}

@Composable
private fun CustomerListBody(
    state: CustomerListUiState,
    onSelectCustomer: (String) -> Unit,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
) {
    val colors = KlinaraTheme.colors

    when (val visible = state.visible) {
        Loadable.Loading ->
            Text(
                text = "Yükleniyor…",
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
                modifier = Modifier.padding(horizontal = KlinaraMetrics.screenInset),
            )

        is Loadable.Failed ->
            ErrorBanner(
                message = visible.message,
                onRetry = if (visible.isRetryable) onRetry else null,
                modifier = Modifier.padding(horizontal = KlinaraMetrics.screenInset),
            )

        is Loadable.Loaded ->
            if (visible.value.isEmpty()) {
                // "Eşleşme yok" ile "hiç müşteri yok" AYRI iki şey: ikincisini arama
                // sonucu gibi göstermek, kullanıcıya var olmayan bir filtreyi aratırdı.
                EmptyStateView(
                    title = if (state.isSearching) "Eşleşen müşteri yok" else "Henüz müşteri yok",
                    message =
                        if (state.isSearching) {
                            "\"${state.term}\" için sonuç bulunamadı. Farklı bir ad ya da numara deneyin."
                        } else {
                            "Bu kiracıda kayıtlı müşteri bulunmuyor."
                        },
                    icon = Icons.Filled.Person,
                )
            } else {
                CustomerList(
                    customers = visible.value,
                    canLoadMore = state.canLoadMore,
                    isLoadingMore = state.isLoadingMore,
                    onSelectCustomer = onSelectCustomer,
                    onLoadMore = onLoadMore,
                )
            }
    }
}

@Composable
private fun CustomerList(
    customers: List<Customer>,
    canLoadMore: Boolean,
    isLoadingMore: Boolean,
    onSelectCustomer: (String) -> Unit,
    onLoadMore: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().testTag("customer-list"),
        contentPadding = PaddingValues(KlinaraMetrics.screenInset),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        items(customers, key = { it.id }) { customer ->
            CustomerRow(customer = customer, onClick = { onSelectCustomer(customer.id) })
        }

        if (canLoadMore || isLoadingMore) {
            item {
                // Görününce sonraki sayfayı ister. Birden çok kez tetiklenebilir ve bu
                // sorun değil — ViewModel uçuştaki isteği zaten yutuyor.
                LaunchedEffect(customers.size) { onLoadMore() }
                Text(
                    text = "Yükleniyor…",
                    style = KlinaraType.bodyM,
                    color = KlinaraTheme.colors.charcoalMuted,
                    modifier = Modifier.fillMaxWidth().padding(KlinaraMetrics.md),
                )
            }
        }
    }
}

@Composable
private fun CustomerRow(
    customer: Customer,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    // Telefon yoksa e-posta; ikisi de yoksa satır adla yetinir — "—" yazmak, olmayan
    // bir veriyi eksik bir veri gibi gösterirdi.
    val detail = customer.phone?.let(PhoneNumber::pretty) ?: customer.email

    KlinaraCard {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .klinaraClickable(true, Role.Button, interactionSource, onClick)
                    .semantics(mergeDescendants = true) {},
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            Text(text = customer.fullName, style = KlinaraType.bodyEmphasis, color = colors.charcoal)
            if (detail != null) {
                Text(text = detail, style = KlinaraType.bodyM, color = colors.charcoalMuted)
            }
            CustomerTagRow(tags = customer.tags)
        }
    }
}
