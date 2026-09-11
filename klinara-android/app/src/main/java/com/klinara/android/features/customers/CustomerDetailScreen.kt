package com.klinara.android.features.customers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.PhoneNumber
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.customers.files.CustomerFilesSection
import com.klinara.android.features.packages.CustomerPackagesCard
import com.klinara.android.features.customers.files.CustomerFilesViewModel
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable

/**
 * Müşteri kartı.
 *
 * A4.1 kartın **kimlik yarısını** çiziyor: ad, iletişim, adres, kaynak, etiket.
 * Notlar ve zaman çizelgesi A4.3'te, fotoğraf ve dosyalar A4.4'te bu ekranın altına
 * biner; paket bölümü A5.2'de geldi, cari hesap (A6.1) de buraya gelecek.
 *
 * **Sheet değil, gerçek bir `NavHost` hedefi** (Kural 2): sistem geri tuşu ve tahmini
 * geri kendiliğinden çalışsın diye.
 */
@Composable
fun CustomerDetailScreen(
    session: AppSession,
    container: ServiceContainer,
    customerId: String,
    onBack: () -> Unit,
    onEdit: (String) -> Unit,
    onMerge: (String) -> Unit,
    onOpenNote: (customerId: String, noteId: String?) -> Unit,
    onOpenPhoto: (customerId: String, fileId: String) -> Unit,
    onOpenDocument: (customerId: String, fileId: String) -> Unit,
    onOpenGroups: (String) -> Unit,
    onUploadFile: (customerId: String, isPhoto: Boolean) -> Unit,
    onOpenPackage: (packageId: String) -> Unit,
    /** `null` ise (`package:write` yok) "Paket sat" çizilmez. */
    onSellPackage: ((customerId: String) -> Unit)?,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val viewModel: CustomerDetailViewModel =
        viewModel(
            key = "customer-$customerId",
            factory = CustomerDetailViewModel.factory(container, customerId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val clock = remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }

    LaunchedEffect(customerId) { viewModel.load() }
    // Arşivlenen kayıt artık listede yok; kartta kalmak boş bir ekranda durmak olurdu.
    LaunchedEffect(state.archived) { if (state.archived) onBack() }

    val canWrite = session.can(Permissions.CUSTOMER_WRITE)
    val canReadMedical = session.can(Permissions.CUSTOMER_MEDICAL_READ)
    val canMerge = session.can(Permissions.CUSTOMER_MERGE)
    val canReadNotifications = session.can(Permissions.NOTIFICATION_READ)

    // Kayıt verisi AYRI bir ViewModel'de ve kartla birlikte doğuyor: notu ve çizelgeyi
    // liste ViewModel'ine koymak, açılmış her müşterinin sağlık verisini oturum boyunca
    // bellekte tutmak olurdu (§7.9).
    val recordViewModel: CustomerRecordViewModel =
        viewModel(
            key = "customer-record-$customerId",
            factory =
                CustomerRecordViewModel.factory(
                    container = container,
                    customerId = customerId,
                    canReadMedical = canReadMedical,
                    canWriteMedical = session.can(Permissions.CUSTOMER_MEDICAL_WRITE),
                ),
        )
    val record by recordViewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(customerId) { recordViewModel.load() }

    val filesViewModel: CustomerFilesViewModel =
        viewModel(
            key = "customer-files-$customerId",
            factory = CustomerFilesViewModel.factory(container, customerId),
        )
    val fileState by filesViewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(customerId) { filesViewModel.load() }

    Box {
        KlinaraScreen(
            title = state.customer.valueOrNull?.fullName ?: "Müşteri",
            modifier = modifier,
            onBack = onBack,
            trailing = trailing,
        ) {
            state.error?.let {
                ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError)
            }

            when (val loadable = state.customer) {
                Loadable.Loading ->
                    Text(
                        text = "Yükleniyor…",
                        style = KlinaraType.bodyM,
                        color = KlinaraTheme.colors.charcoalMuted,
                    )

                is Loadable.Failed ->
                    ErrorBanner(
                        message = loadable.message,
                        onRetry = if (loadable.isRetryable) viewModel::load else null,
                    )

                is Loadable.Loaded -> {
                    CustomerDetailBody(customer = loadable.value, clock = clock)

                    record.error?.let {
                        ErrorBanner(message = it, retryLabel = "Kapat", onRetry = recordViewModel::dismissError)
                    }

                    CustomerNotesSection(
                        notes = record.notes,
                        canReadMedical = canReadMedical,
                        canWrite = canWrite,
                        clock = clock,
                        onSelectNote = { onOpenNote(customerId, it) },
                        onCreateNote = { onOpenNote(customerId, null) },
                    )

                    CustomerPackagesCard(
                        session = session,
                        container = container,
                        customerId = customerId,
                        clock = clock,
                        onOpen = onOpenPackage,
                        onSell = onSellPackage,
                    )

                    CustomerFilesSection(
                        state = fileState,
                        thumbnails = filesViewModel.thumbnails,
                        canReadMedical = canReadMedical,
                        canWriteMedical = session.can(Permissions.CUSTOMER_MEDICAL_WRITE),
                        canWrite = canWrite,
                        onOpenPhoto = { onOpenPhoto(customerId, it) },
                        onOpenDocument = { onOpenDocument(customerId, it) },
                        onAddPhoto = { onUploadFile(customerId, true) },
                        onAddDocument = { onUploadFile(customerId, false) },
                        onOpenGroups = { onOpenGroups(customerId) },
                        onDismissError = filesViewModel::dismissError,
                    )

                    CustomerTimelineSection(
                        state = record,
                        canReadMedical = canReadMedical,
                        clock = clock,
                        onApplyFilter = recordViewModel::applyFilter,
                        onClearFilter = recordViewModel::clearFilter,
                        onLoadMore = recordViewModel::loadMore,
                        onSelectNote = { onOpenNote(customerId, it) },
                    )

                    // İzinsiz kullanıcıda bu bölüm HİÇ kurulmaz — boş bir kart
                    // "bu müşteriye her şey gönderilebilir" derdi ve bu yanlış bilgi.
                    if (canReadNotifications) {
                        CustomerOptOutSection(
                            session = session,
                            container = container,
                            customerId = customerId,
                            clock = clock,
                        )
                    }

                    CustomerActions(
                        canWrite = canWrite,
                        canMerge = canMerge,
                        onEdit = { onEdit(customerId) },
                        onMerge = { onMerge(customerId) },
                        onArchive = viewModel::askArchive,
                    )
                }
            }
        }

        if (state.isArchiving) AuthLoadingOverlay(message = "Arşivleniyor…")
    }

    if (state.askArchive) {
        AlertDialog(
            onDismissRequest = viewModel::cancelArchive,
            title = { Text("Müşteri arşivlensin mi?", style = KlinaraType.titleM) },
            text = {
                // "Sil" demiyoruz çünkü silmiyoruz; telefon numarasının serbest kalması
                // da kullanıcının bilmesi gereken bir sonuç.
                Text(
                    "Kayıt silinmez, arşivlenir ve listede görünmez. Telefon numarası " +
                        "yeniden kullanılabilir hâle gelir.",
                    style = KlinaraType.bodyM,
                )
            },
            confirmButton = { TextButton(onClick = viewModel::archive) { Text("Arşivle") } },
            dismissButton = { TextButton(onClick = viewModel::cancelArchive) { Text("Vazgeç") } },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        )
    }
}

/**
 * Kart aksiyonları — hepsi izne bağlı.
 *
 * Yetkisi olmayana düğmeyi gösterip içeride 403 vermek, ona yapamayacağı bir şeyi
 * vaat etmektir (§5.7).
 */
@Composable
private fun CustomerActions(
    canWrite: Boolean,
    canMerge: Boolean,
    onEdit: () -> Unit,
    onMerge: () -> Unit,
    onArchive: () -> Unit,
) {
    if (!canWrite && !canMerge) return

    KlinaraCard(title = "İşlemler") {
        if (canWrite) {
            KlinaraButton(
                title = "Düzenle",
                onClick = onEdit,
                kind = KlinaraButtonKind.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (canMerge) {
            KlinaraButton(
                title = "Mükerrer kaydı birleştir",
                onClick = onMerge,
                kind = KlinaraButtonKind.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (canWrite) {
            KlinaraButton(
                title = "Müşteriyi arşivle",
                onClick = onArchive,
                kind = KlinaraButtonKind.Tertiary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun CustomerDetailBody(
    customer: Customer,
    clock: BranchClock,
) {
    val colors = KlinaraTheme.colors

    // Birleştirilmiş bir kayda elinde eski bağlantı olan biri gelebilir; nereye
    // gittiğini SÖYLEMEK, boş bir kart göstermekten iyidir.
    if (customer.isMerged) {
        ErrorBanner(
            message = "Bu kayıt başka bir müşteriyle birleştirildi ve artık kullanılmıyor.",
        )
    }

    KlinaraCard(title = "Bilgiler") {
        // Telefonu olmayan müşteri var (kapıdan gelen, numara vermek istemeyen);
        // satırı hiç çizmemek, boş bir değer göstermekten dürüst.
        customer.phone?.let { KlinaraRow(label = "Telefon", value = PhoneNumber.pretty(it)) }
        customer.email?.let { KlinaraRow(label = "E-posta", value = it) }
        customer.birthDate?.let { KlinaraRow(label = "Doğum tarihi", value = formatBirthDate(it)) }
        customer.gender?.let { KlinaraRow(label = "Cinsiyet", value = it.turkishName) }
        customer.addressSummary?.let { KlinaraRow(label = "Adres", value = it) }
        customer.postalCode?.let { KlinaraRow(label = "Posta kodu", value = it) }
        customer.source?.let { KlinaraRow(label = "Geliş kaynağı", value = it.turkishName) }
        customer.createdAt?.let { KlinaraRow(label = "Kayıt tarihi", value = clock.formatDateTime(it)) }
    }

    if (customer.tags.isNotEmpty()) {
        KlinaraCard(title = "Etiketler") {
            CustomerTagRow(tags = customer.tags, modifier = Modifier.fillMaxWidth())
        }
    }

    customer.notes?.takeIf { it.isNotBlank() }?.let { notes ->
        // Kartın SERBEST notu — klinik not değil. İkisini aynı kartta göstermek,
        // `customer.medical:read` ile kapılı olanı olmayanla karıştırmak olurdu.
        KlinaraCard(title = "Not") {
            Text(text = notes, style = KlinaraType.bodyM, color = colors.charcoal)
        }
    }

}

/** `"1990-05-12"` → `"12.05.1990"`. Çözülemezse ham değer — uydurmaktansa göstermek. */
private fun formatBirthDate(raw: String): String =
    runCatching {
        val (year, month, day) = raw.split("-")
        "$day.$month.$year"
    }.getOrDefault(raw)
