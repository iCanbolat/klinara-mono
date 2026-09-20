package com.klinara.android.features.packages

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
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
import com.klinara.android.designsystem.components.KlinaraCheckMenuItem
import com.klinara.android.designsystem.components.KlinaraIcons
import com.klinara.android.designsystem.components.KlinaraOverflowMenu
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSearchField
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.KlinaraToolbarAction
import com.klinara.android.designsystem.components.klinaraClickable
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
 * **Kontroller gövdede değil üst çubukta** (iOS kalıbı): arama ince bir şerit, "pasifleri
 * göster" ve şube kapsamı `KlinaraOverflowMenu` içinde. Üçü de gövdedeyken listeden önce
 * üç satır kontrol geliyordu ve ilk paket ekranın dışında kalıyordu.
 *
 * **iOS'tan sapma:** iOS emekliye ayırmayı `swipeActions`'a koyuyor. Android'de kaydırma
 * jesti yerleşik bir keşif kalıbı değil ve TalkBack kullanıcısına hiç görünmez; eylem
 * satırın kendi "⋮" menüsünde — kartın içindeki tam genişlikte düğme, listeyi her satırda
 * ikiye bölüyordu.
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
    var showsInactive by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    val scope = if (scopedToBranch) session.activeBranchId else null

    // Editörden dönüşte de koşar (gezinme bu ekranı yeniden kurar) ve sessizce tazeler.
    LaunchedEffect(scope) { viewModel.ensureScope(scope) }

    Box {
        KlinaraScreen(
            title = "Paketler",
            modifier = modifier,
            onBack = onBack,
            trailing = {
                if (canWrite) KlinaraToolbarAction(contentDescription = "Yeni paket", onClick = { onOpen(null) })
                KlinaraOverflowMenu {
                    KlinaraCheckMenuItem(
                        label = "Pasifleri göster",
                        isChecked = showsInactive,
                        onToggle = { showsInactive = it },
                    )
                    // Tek şubeli kiracıda çizilmez: seçenek sunmayan bir seçici, yer
                    // kaplayan bir yanıltmadır. Oturumun şube menüsüne KATILMADI: orası
                    // seçili şubeyi tüm uygulama için değiştirir, burası yalnız kapsam.
                    if (session.canSwitchBranch) {
                        KlinaraCheckMenuItem(
                            label = session.activeBranch?.name?.let { "Yalnız $it" } ?: "Yalnız seçili şube",
                            isChecked = scopedToBranch,
                            onToggle = { scopedToBranch = it },
                        )
                    }
                }
                trailing?.invoke(this)
            },
        ) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }

            DefinitionsSection(
                state = state,
                session = session,
                canWrite = canWrite,
                query = query,
                onQuery = { query = it },
                showsInactive = showsInactive,
                viewModel = viewModel,
                onOpen = { onOpen(it.id) },
                onCreate = { onOpen(null) },
            )
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
@Suppress("LongParameterList")
@Composable
private fun DefinitionsSection(
    state: PackageDefinitionListUiState,
    session: AppSession,
    canWrite: Boolean,
    query: String,
    onQuery: (String) -> Unit,
    showsInactive: Boolean,
    viewModel: PackageDefinitionListViewModel,
    onOpen: (PackageDefinition) -> Unit,
    onCreate: () -> Unit,
) {
    when (val definitions = state.definitions) {
        Loadable.Loading ->
            KlinaraSkeleton(style = KlinaraSkeletonStyle.cards)

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
                    iconRes = KlinaraIcons.packageBox,
                    actionTitle = if (canWrite) "Yeni paket" else null,
                    onAction = if (canWrite) onCreate else null,
                )
            } else {
                KlinaraSearchField(value = query, onValueChange = onQuery, placeholder = "Paket ara")
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
            DefinitionRow(
                definition = definition,
                session = session,
                canRetire = canWrite && !definition.isArchived && definition.isActive,
                onClick = { onOpen(definition) },
                onRetire = { onRetire(definition) },
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DefinitionRow(
    definition: PackageDefinition,
    session: AppSession,
    canRetire: Boolean,
    onClick: () -> Unit,
    onRetire: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    Row(verticalAlignment = Alignment.Top) {
        Column(
            modifier =
                Modifier
                    .weight(1f)
                    .klinaraClickable(true, Role.Button, interactionSource, onClick),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    definition.name,
                    style = KlinaraType.bodyEmphasis,
                    color = colors.charcoal,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    Money.format(definition.totalPriceMinor, definition.currency),
                    style = KlinaraType.bodyEmphasis,
                    color = colors.charcoal,
                )
                // Üstü çizili liste fiyatı yalnız indirim varken: eşitken göstermek
                // "indirim yok" mesajını gürültüye çevirirdi.
                if (definition.discountMinor != null) {
                    Text(
                        Money.format(definition.listPriceMinor, definition.currency),
                        style = KlinaraType.bodyM.copy(textDecoration = TextDecoration.LineThrough),
                        color = colors.charcoalMuted,
                    )
                }
            }

            // Kalem dökümü ile geçerlilik AYRI satırlarda: tek bir noktalı dizide ikisi de
            // okunmuyordu ve hangisinin nerede bittiği belli olmuyordu.
            Text(contents(definition), style = KlinaraType.bodyM, color = colors.charcoalMuted)
            Text(validity(definition), style = KlinaraType.bodyM, color = colors.charcoalMuted)

            // Rozet sırası iki platformda SABİT: indirim → durum → şube → online →
            // devredilemez. Sıra değişirse aynı paket iki uygulamada farklı okunur.
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

        if (canRetire) {
            KlinaraOverflowMenu {
                    dismiss ->
                DropdownMenuItem(
                    text = { Text("Emekliye ayır", style = KlinaraType.bodyL, color = colors.charcoal) },
                    onClick = {
                        dismiss()
                        onRetire()
                    },
                )
            }
        }
    }
}

/** "12 seans · 10 Lazer epilasyon, 2 Cilt bakımı" — paketin İÇİ. */
internal fun contents(definition: PackageDefinition): String =
    buildList {
        add("${definition.totalSessions} seans")
        definition.sortedItems
            .joinToString(", ") { "${it.quantity} ${it.serviceName}" }
            .takeIf { it.isNotEmpty() }
            ?.let(::add)
    }.joinToString(" · ")

/**
 * Geçerlilik kendi satırında: paketin satılabilirliğini belirleyen ikinci bilgi o ve kalem
 * dökümünün kuyruğunda kayboluyordu.
 */
internal fun validity(definition: PackageDefinition): String =
    definition.validityDays?.let { "$it gün geçerli" } ?: "Süresiz"

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
