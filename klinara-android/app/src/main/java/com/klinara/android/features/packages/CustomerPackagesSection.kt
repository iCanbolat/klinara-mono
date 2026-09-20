package com.klinara.android.features.packages

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraSkeletonSection
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.CustomerPackage
import com.klinara.android.services.packages.CustomerPackageStatus
import java.time.Instant

/**
 * Kartın paket bloğu — ViewModel'i kurar ve izin yoksa HİÇBİR ŞEY çizmez.
 *
 * `CustomerDetailScreen`'den ayrı: bölümün kendi ViewModel'i, kendi izni ve kendi
 * yükleme anı var; ekran fonksiyonuna gömmek onu okunmaz bir karmaşıklığa itiyordu.
 * İzinsiz rolde boş bir kart "paketi yok" derdi ve bu doğru değil — yalnız göremiyor.
 *
 * Paketler kartla doğar; satış/iade/devir dönüşünde gezinme bu bloğu yeniden kuruyor ve
 * liste TAZE geliyor — kalan hak yerelde hiç güncellenmiyor.
 */
@Composable
fun CustomerPackagesCard(
    session: AppSession,
    container: ServiceContainer,
    customerId: String,
    clock: BranchClock,
    onOpen: (packageId: String) -> Unit,
    onSell: ((customerId: String) -> Unit)?,
) {
    if (!session.can(Permissions.PACKAGE_READ)) return
    val viewModel: CustomerPackagesViewModel =
        viewModel(
            key = "customer-packages-$customerId",
            factory = CustomerPackagesViewModel.factory(container, customerId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(customerId) { viewModel.load() }

    CustomerPackagesSection(
        state = state,
        clock = clock,
        onOpen = onOpen,
        onSell = onSell?.let { sell -> { sell(customerId) } },
        onRetry = viewModel::load,
        onLoadMore = viewModel::loadMore,
    )
}

/**
 * Müşteri kartının paket bölümü.
 *
 * Kartta gösterilen şey **kalan hak**tır, satış geçmişi değil. Her satır kalem dökümünü
 * taşır ("Lazer epilasyon: 6/10 · Cilt bakımı: 1/2") çünkü "kalan 7" tek başına HANGİ
 * hizmetten olduğunu söylemez — fazın var olma sebebi bu.
 *
 * [onSell] `null` ise (`package:write` yok) "Paket sat" hiç çizilmez (§7.4).
 */
@Composable
fun CustomerPackagesSection(
    state: CustomerPackagesUiState,
    clock: BranchClock,
    onOpen: (packageId: String) -> Unit,
    onSell: (() -> Unit)?,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
) {
    when (val packages = state.packages) {
        Loadable.Loading ->
            KlinaraCard(title = "Paketler", modifier = modifier) {
                KlinaraSkeletonSection()
            }

        is Loadable.Failed ->
            ErrorBanner(message = packages.message, onRetry = if (packages.isRetryable) onRetry else null)

        is Loadable.Loaded ->
            KlinaraCard(title = "Paketler", footnote = footnote(state), modifier = modifier) {
                if (packages.value.isEmpty()) KlinaraRow(label = "Henüz paket yok")

                state.ordered.forEachIndexed { index, pkg ->
                    if (index > 0) KlinaraDivider()
                    PackageRow(pkg = pkg, clock = clock, now = now, onClick = { onOpen(pkg.id) })
                }

                if (state.canLoadMore || state.isLoadingMore) {
                    KlinaraButton(
                        title = "Daha fazla paket",
                        onClick = onLoadMore,
                        kind = KlinaraButtonKind.Tertiary,
                        isLoading = state.isLoadingMore,
                    )
                }

                onSell?.let {
                    KlinaraDivider()
                    KlinaraButton(
                        title = "Paket sat",
                        onClick = it,
                        kind = KlinaraButtonKind.Secondary,
                        icon = Icons.Filled.ShoppingCart,
                    )
                }
            }
    }
}

private fun footnote(state: CustomerPackagesUiState): String? =
    state.totalRemainingSessions.takeIf { it > 0 }?.let { "Toplam $it seans hakkı var." }

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PackageRow(
    pkg: CustomerPackage,
    clock: BranchClock,
    now: Instant,
    onClick: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
        KlinaraNavigationRow(
            label = pkg.name,
            value = "${pkg.remainingSessions}/${pkg.totalSessions} seans kaldı",
            detail = itemSummary(pkg),
            onClick = onClick,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
            statusBadges(pkg, clock, now).forEach { (text, tone) -> KlinaraBadge(text, tone = tone) }
        }
    }
}

/** "Lazer epilasyon: 6/10 · Cilt bakımı: 1/2". */
internal fun itemSummary(pkg: CustomerPackage): String =
    pkg.sortedItems.joinToString(" · ") { "${it.serviceName}: ${it.remainingSessions}/${it.quantityTotal}" }

/**
 * Rozetler — durum önce, sonra tarihe dayalı uyarılar.
 *
 * Süre dolumu yalnız DURUMA bakmıyor: kapatma bir cron işi ve süresi geçmiş bir paket
 * birkaç saat daha `active` görünebilir. Ekran tarihe bakar.
 */
internal fun statusBadges(
    pkg: CustomerPackage,
    clock: BranchClock,
    now: Instant,
): List<Pair<String, KlinaraBadgeTone>> =
    buildList {
        when {
            pkg.status != CustomerPackageStatus.Active -> add(pkg.status.turkishName to toneOf(pkg.status))
            pkg.isExpired(now) -> add("Süresi doldu" to KlinaraBadgeTone.Warning)
            pkg.expiresSoon(now) ->
                add("${clock.formatDate(pkg.expiresAt!!)} tarihinde doluyor" to KlinaraBadgeTone.Warning)
        }
        if (pkg.status == CustomerPackageStatus.Active && pkg.remainingSessions == 0) {
            add("Hak bitti" to KlinaraBadgeTone.Muted)
        }
    }

internal fun toneOf(status: CustomerPackageStatus): KlinaraBadgeTone =
    when (status) {
        CustomerPackageStatus.Active -> KlinaraBadgeTone.Positive
        CustomerPackageStatus.Expired -> KlinaraBadgeTone.Warning
        CustomerPackageStatus.Refunded, CustomerPackageStatus.Transferred, CustomerPackageStatus.Unknown ->
            KlinaraBadgeTone.Muted
    }
