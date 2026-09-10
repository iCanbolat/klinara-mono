package com.klinara.android.features.packages

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextDecoration
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.TurkishLocale
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.PackageDefinition

/**
 * Paket tanımları — kliniğin satabildiği şablonlar (A5.1).
 *
 * Liste **fiyatı ve indirimi** öne çıkarır: bir paketin var olma sebebi kampanyalı
 * fiyatıdır, kalem dökümü ikinci sıradadır.
 *
 * `package:read` görür, `package:write` değiştirir. Yazma izni olmayanda "Yeni paket" ve
 * "Emekliye ayır" HİÇ çizilmez; satır yine açılır ama editör salt okunur.
 *
 * **iOS'tan sapma:** iOS emekliye ayırmayı `swipeActions`'a koyuyor. Android'de kaydırma
 * jesti yerleşik bir keşif kalıbı değil ve TalkBack kullanıcısına hiç görünmez; eylem
 * kartın içinde açık bir düğme.
 */
@Composable
fun PackageDefinitionListScreen(
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    onOpen: (definitionId: String?) -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val viewModel: PackageDefinitionListViewModel =
        viewModel(key = "package-definitions", factory = PackageDefinitionListViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canWrite = session.can(Permissions.PACKAGE_WRITE)

    // Varsayılan KAPALI: tanım ekranı bir yönetim ekranı ve çoğu paket şube kısıtı taşımıyor.
    var scopedToBranch by rememberSaveable { mutableStateOf(false) }
    val scope = if (scopedToBranch) session.activeBranchId else null

    // Editörden dönüşte de koşar (gezinme bu ekranı yeniden kurar) ve sessizce tazeler.
    LaunchedEffect(scope) { viewModel.ensureScope(scope) }

    Box {
        KlinaraScreen(title = "Paketler", modifier = modifier, onBack = onBack, trailing = trailing) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }

            // Tek şubeli kiracıda çizilmez: seçenek sunmayan bir seçici, yer kaplayan bir yanıltmadır.
            if (session.canSwitchBranch) {
                KlinaraSegmentedPicker(
                    options = listOf(false, true),
                    selected = scopedToBranch,
                    onSelect = { scopedToBranch = it },
                    title = { if (it) session.activeBranch?.name ?: "Seçili şube" else "Tüm şubeler" },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            DefinitionsSection(
                state = state,
                session = session,
                canWrite = canWrite,
                viewModel = viewModel,
                onOpen = { onOpen(it.id) },
            )

            if (canWrite) {
                KlinaraButton(
                    title = "Yeni paket",
                    onClick = { onOpen(null) },
                    kind = KlinaraButtonKind.Secondary,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }

    state.pendingRetirement?.let { definition ->
        AlertDialog(
            onDismissRequest = viewModel::cancelRetire,
            title = { Text("Paket emekliye ayrılsın mı?", style = KlinaraType.titleM) },
            text = {
                // İki ayrı sonuç var ve hangisinin olacağını satış geçmişi belirliyor;
                // kullanıcı "sildim" sanmasın.
                Text(
                    "\"${definition.name}\" hiç satılmadıysa arşivlenir, satıldıysa yalnız pasife alınır. " +
                        "Satılmış paketler ve müşteri hakları etkilenmez.",
                    style = KlinaraType.bodyM,
                )
            },
            confirmButton = { TextButton(onClick = viewModel::confirmRetire) { Text("Emekliye ayır") } },
            dismissButton = { TextButton(onClick = viewModel::cancelRetire) { Text("Vazgeç") } },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        )
    }
}

/**
 * Listenin durum dalları — ekran fonksiyonundan ayrı: arama, filtre ve sayfalama aynı
 * gövdede birleşince tek bir `@Composable` okunmaz hâle geliyordu.
 */
@Composable
private fun DefinitionsSection(
    state: PackageDefinitionListUiState,
    session: AppSession,
    canWrite: Boolean,
    viewModel: PackageDefinitionListViewModel,
    onOpen: (PackageDefinition) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var showsInactive by rememberSaveable { mutableStateOf(false) }

    when (val definitions = state.definitions) {
        Loadable.Loading ->
            Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)

        is Loadable.Failed ->
            ErrorBanner(
                message = definitions.message,
                onRetry = if (definitions.isRetryable) viewModel::reload else null,
            )

        is Loadable.Loaded ->
            if (definitions.value.isEmpty()) {
                EmptyStateView(
                    title = "Henüz paket yok",
                    message =
                        if (canWrite) {
                            "İlk paketi tanımlayarak başlayın. Bir paket birden çok hizmet kalemi içerebilir."
                        } else {
                            "Paket tanımlamak için yöneticinizle görüşün."
                        },
                    icon = Icons.Filled.ShoppingCart,
                )
            } else {
                KlinaraTextField(label = "Paket ara", value = query, onValueChange = { query = it })
                KlinaraToggleRow(
                    label = "Pasifleri göster",
                    isOn = showsInactive,
                    onToggle = { showsInactive = it },
                )
                DefinitionList(
                    definitions = filtered(definitions.value, query, showsInactive),
                    session = session,
                    canWrite = canWrite,
                    onOpen = onOpen,
                    onRetire = viewModel::askRetire,
                )
                if (state.canLoadMore) {
                    KlinaraButton(
                        title = "Daha fazla yükle",
                        onClick = viewModel::loadMore,
                        kind = KlinaraButtonKind.Tertiary,
                        isLoading = state.isLoadingMore,
                    )
                }
            }
    }
}

@Composable
private fun DefinitionList(
    definitions: List<PackageDefinition>,
    session: AppSession,
    canWrite: Boolean,
    onOpen: (PackageDefinition) -> Unit,
    onRetire: (PackageDefinition) -> Unit,
) {
    if (definitions.isEmpty()) {
        Text("Aramanızla eşleşen paket yok.", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
        return
    }
    definitions.forEach { definition ->
        KlinaraCard {
            DefinitionRow(definition = definition, session = session, onClick = { onOpen(definition) })
            if (canWrite && !definition.isArchived && definition.isActive) {
                KlinaraDivider()
                KlinaraButton(
                    title = "Emekliye ayır",
                    onClick = { onRetire(definition) },
                    kind = KlinaraButtonKind.Tertiary,
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DefinitionRow(
    definition: PackageDefinition,
    session: AppSession,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
        KlinaraNavigationRow(label = definition.name, detail = summary(definition), onClick = onClick)
        Row(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                Money.format(definition.totalPriceMinor, definition.currency),
                style = KlinaraType.bodyEmphasis,
                color = colors.charcoal,
            )
            // Üstü çizili liste fiyatı yalnız indirim varken: eşitken göstermek "indirim yok"
            // mesajını gürültüye çevirirdi.
            if (definition.discountMinor != null) {
                Text(
                    Money.format(definition.listPriceMinor, definition.currency),
                    style = KlinaraType.bodyM.copy(textDecoration = TextDecoration.LineThrough),
                    color = colors.charcoalMuted,
                )
            }
        }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            definition.discountPercent?.let { KlinaraBadge("%$it indirim", tone = KlinaraBadgeTone.Positive) }
            when {
                definition.isArchived -> KlinaraBadge("Arşiv", tone = KlinaraBadgeTone.Muted)
                !definition.isActive -> KlinaraBadge("Pasif", tone = KlinaraBadgeTone.Muted)
            }
            // Rozet şubenin ADINI taşır: "şubeye özel" hangi şube olduğunu söylemiyordu.
            definition.branchId?.let { branchId ->
                KlinaraBadge(session.branches.firstOrNull { it.id == branchId }?.name ?: "Şubeye özel")
            }
            if (definition.isOnlineSellable) KlinaraBadge("Online", tone = KlinaraBadgeTone.Positive)
            if (!definition.isTransferable) KlinaraBadge("Devredilemez", tone = KlinaraBadgeTone.Warning)
        }
    }
}

/**
 * "12 seans · 10 Lazer epilasyon, 2 Cilt bakımı · 365 gün geçerli".
 *
 * Geçerlilik burada duruyor çünkü paketin satılabilirliğini belirleyen ikinci bilgi o.
 */
internal fun summary(definition: PackageDefinition): String =
    buildList {
        add("${definition.totalSessions} seans")
        definition.sortedItems
            .joinToString(", ") { "${it.quantity} ${it.serviceName}" }
            .takeIf { it.isNotEmpty() }
            ?.let(::add)
        add(definition.validityDays?.let { "$it gün geçerli" } ?: "Süresiz")
    }.joinToString(" · ")

private fun filtered(
    definitions: List<PackageDefinition>,
    query: String,
    showsInactive: Boolean,
): List<PackageDefinition> {
    val needle = query.trim().lowercase(TurkishLocale)
    return definitions
        .filter { showsInactive || (it.isActive && !it.isArchived) }
        .filter {
            needle.isEmpty() || it.name.lowercase(TurkishLocale).contains(needle) || it.slug.contains(needle)
        }.sortedBy { it.name.lowercase(TurkishLocale) }
}
