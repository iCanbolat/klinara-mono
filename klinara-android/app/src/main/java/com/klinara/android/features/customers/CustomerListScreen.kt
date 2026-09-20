package com.klinara.android.features.customers

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.FabContentClearance
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraFab
import com.klinara.android.designsystem.components.KlinaraFabBox
import com.klinara.android.designsystem.components.KlinaraFilterPill
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSearchField
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.PhoneNumber
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerTag
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
    LaunchedEffect(Unit) {
        viewModel.load()
        viewModel.loadTags()
    }

    // Arama alanı yerel metni tutar: ViewModel terimi kırpıyor ve kırpılmış değeri geri
    // yazmak, kelime arasındaki boşluğu yazarken siliyordu.
    var query by rememberSaveable { mutableStateOf(state.term) }

    KlinaraFabBox(
        fab = onCreateCustomer?.let { create -> { KlinaraFab(contentDescription = "Yeni müşteri", onClick = create) } },
        modifier = modifier,
    ) {
        KlinaraScreen(
            title = "Müşteriler",
            scrollable = false,
            contentPadding = PaddingValues(top = KlinaraMetrics.sm),
            verticalSpacing = KlinaraMetrics.sm,
            trailing = trailing,
        ) {
            // Arama ve etiket filtresi TEK bir başlık bloğu: ikisi de listeyi daraltıyor ve
            // araları açıldığında filtre satırı, listenin ilk satırı gibi okunuyordu.
            Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
                KlinaraSearchField(
                    value = query,
                    onValueChange = {
                        query = it
                        viewModel.search(it)
                    },
                    placeholder = "Ad veya telefon",
                    modifier = Modifier.padding(horizontal = KlinaraMetrics.md),
                )

                TagFilterRow(tags = state.tags, selectedTagId = state.selectedTagId, onSelect = viewModel::selectTag)

                ActiveFilterRow(state = state, onClear = { viewModel.selectTag(null) })

                HorizontalDivider(color = KlinaraTheme.colors.border, thickness = KlinaraMetrics.borderWidth)
            }

            CustomerListBody(
                state = state,
                onSelectCustomer = onSelectCustomer,
                onRetry = if (state.isSearching) viewModel::retrySearch else viewModel::reload,
                onLoadMore = viewModel::loadMore,
                onRetryLoadMore = viewModel::retryLoadMore,
                bottomClearance = if (onCreateCustomer != null) FabContentClearance else 0.dp,
                onCreateCustomer = onCreateCustomer,
            )
        }
    }
}

@Composable
private fun TagFilterRow(
    tags: List<CustomerTag>,
    selectedTagId: String?,
    onSelect: (String?) -> Unit,
) {
    if (tags.isEmpty()) return
    val colors = KlinaraTheme.colors
    LazyRow(
        contentPadding = PaddingValues(horizontal = KlinaraMetrics.md),
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        item(key = "all") {
            KlinaraFilterPill(label = "Tümü", isSelected = selectedTagId == null, onClick = { onSelect(null) })
        }
        items(tags, key = { it.id }) { tag ->
            KlinaraFilterPill(
                label = tag.name,
                isSelected = selectedTagId == tag.id,
                dotColor = parseHexColor(tag.color) ?: colors.charcoalMuted,
                onClick = { onSelect(tag.id) },
            )
        }
    }
}

/**
 * Seçili etiketin özeti.
 *
 * Filtre çipi listeyle birlikte kaydırılıp gözden kayboluyordu: "neden yalnız üç müşteri
 * var?" sorusunun cevabı ekranda kalmalı. Satır yalnız filtre varken çizilir.
 */
@Composable
private fun ActiveFilterRow(
    state: CustomerListUiState,
    onClear: () -> Unit,
) {
    val tagId = state.selectedTagId ?: return
    val colors = KlinaraTheme.colors
    val tagName = state.tags.firstOrNull { it.id == tagId }?.name ?: "Etiket"
    val count = state.visible.valueOrNull?.size
    val interactionSource = remember { MutableInteractionSource() }

    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = KlinaraMetrics.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = if (count == null) tagName else "$tagName · $count müşteri",
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = "Temizle",
            style = KlinaraType.bodyEmphasis,
            color = colors.sageDeep,
            modifier =
                Modifier
                    .klinaraClickable(true, Role.Button, interactionSource, onClear)
                    .padding(vertical = KlinaraMetrics.xs, horizontal = KlinaraMetrics.xs),
        )
    }
}

@Composable
private fun CustomerListBody(
    state: CustomerListUiState,
    onSelectCustomer: (String) -> Unit,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    onRetryLoadMore: () -> Unit,
    bottomClearance: Dp,
    onCreateCustomer: (() -> Unit)?,
) {
    val colors = KlinaraTheme.colors

    when (val visible = state.visible) {
        Loadable.Loading ->
            KlinaraSkeleton(
                style = KlinaraSkeletonStyle.cardsLong,
                modifier = Modifier.padding(horizontal = KlinaraMetrics.md),
            )

        is Loadable.Failed ->
            ErrorBanner(
                message = visible.message,
                onRetry = if (visible.isRetryable) onRetry else null,
                modifier = Modifier.padding(horizontal = KlinaraMetrics.md),
            )

        is Loadable.Loaded ->
            if (visible.value.isEmpty()) {
                CustomerEmptyState(state, onCreateCustomer)
            } else {
                CustomerList(
                    customers = visible.value,
                    canLoadMore = state.canLoadMore,
                    hasMore = state.hasMore,
                    isLoadingMore = state.isLoadingMore,
                    loadMoreError = state.loadMoreError,
                    onSelectCustomer = onSelectCustomer,
                    onLoadMore = onLoadMore,
                    onRetryLoadMore = onRetryLoadMore,
                    bottomClearance = bottomClearance,
                )
            }
    }
}

/**
 * "Eşleşme yok" ile "hiç müşteri yok" AYRI iki şey: ikincisini arama sonucu gibi göstermek,
 * kullanıcıya var olmayan bir filtreyi aratırdı. Arama ya da etiket sonucu boşken CTA da YOK —
 * aranan şey yaratmak değil, bulmak.
 */
@Composable
private fun CustomerEmptyState(
    state: CustomerListUiState,
    onCreateCustomer: (() -> Unit)?,
) {
    val isFiltered = state.isSearching || state.selectedTagId != null
    EmptyStateView(
        title = if (isFiltered) "Eşleşen müşteri yok" else "Henüz müşteri yok",
        message =
            when {
                state.isSearching ->
                    "\"${state.term}\" için sonuç bulunamadı. Farklı bir ad ya da numara deneyin."
                state.selectedTagId != null -> "Bu etikete sahip müşteri bulunmuyor."
                else -> "Bu kiracıda kayıtlı müşteri bulunmuyor."
            },
        icon = Icons.Filled.Person,
        actionTitle = "Yeni müşteri".takeIf { onCreateCustomer != null && !isFiltered },
        onAction = onCreateCustomer?.takeIf { !isFiltered },
    )
}

@Composable
@Suppress("LongParameterList")
private fun CustomerList(
    customers: List<Customer>,
    canLoadMore: Boolean,
    hasMore: Boolean,
    isLoadingMore: Boolean,
    loadMoreError: String?,
    onSelectCustomer: (String) -> Unit,
    onLoadMore: () -> Unit,
    onRetryLoadMore: () -> Unit,
    bottomClearance: Dp,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().testTag("customer-list"),
        contentPadding =
            PaddingValues(
                start = KlinaraMetrics.md,
                end = KlinaraMetrics.md,
                top = KlinaraMetrics.sm,
                bottom = KlinaraMetrics.md + bottomClearance,
            ),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        items(customers, key = { it.id }) { customer ->
            CustomerRow(customer = customer, onClick = { onSelectCustomer(customer.id) })
        }

        if (hasMore || isLoadingMore) {
            item(key = "load-more") {
                if (loadMoreError == null) {
                    // Görününce sonraki sayfayı ister. Birden çok kez tetiklenebilir ve bu
                    // sorun değil — ViewModel uçuştaki isteği zaten yutuyor.
                    LaunchedEffect(customers.size) { if (canLoadMore) onLoadMore() }
                    Text(
                        text = "Yükleniyor…",
                        style = KlinaraType.bodyM,
                        color = KlinaraTheme.colors.charcoalMuted,
                        modifier = Modifier.fillMaxWidth().padding(KlinaraMetrics.md),
                    )
                } else {
                    // Otomatik tetikleme durdu: hatayı görünür kılmadan yeniden denemek,
                    // ağ yokken sonsuz bir döngüye girmek olurdu.
                    ErrorBanner(
                        message = loadMoreError,
                        retryLabel = "Tekrar dene",
                        onRetry = onRetryLoadMore,
                        modifier = Modifier.padding(KlinaraMetrics.md),
                    )
                }
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
