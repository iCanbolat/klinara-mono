package com.klinara.android.features.calendar.booking

import androidx.compose.foundation.background
import com.klinara.android.services.formatting.TrLocale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSkeletonChips
import com.klinara.android.designsystem.components.KlinaraSkeletonSection
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.booking.Appointment
import com.klinara.android.services.booking.AvailabilitySlot
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.DurationFormat
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.networking.Loadable
import java.time.Instant

/**
 * Randevu oluşturma / erteleme.
 *
 * **Sihirbaz DEĞİL, tek sayfa** (iOS ile aynı): bölümler ilerledikçe açılır. Adım adım
 * bir sihirbaz, hizmeti değiştirmek için üç ekran geri gitmeyi gerektirirdi — ve
 * rezervasyon, kliniğin en sık düzeltilen formudur.
 */
@Composable
fun BookingFlowScreen(
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    onCreated: (Appointment) -> Unit,
    modifier: Modifier = Modifier,
    rescheduling: Appointment? = null,
    startingAt: Instant? = null,
) {
    val clock = remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }
    val branchId = session.activeBranchId

    if (branchId == null) {
        KlinaraScreen(title = "Yeni randevu", onBack = onBack, modifier = modifier) {
            ErrorBanner(message = "Randevu oluşturmak için önce bir şube seçin.")
        }
        return
    }

    val viewModel: BookingFlowViewModel =
        viewModel(
            key = "booking-${rescheduling?.id ?: "new"}",
            factory =
                BookingFlowViewModel.factory(container, clock, branchId, rescheduling, startingAt),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.load() }
    LaunchedEffect(viewModel.availabilityKey()) { viewModel.loadSlots() }
    LaunchedEffect(state.created) { state.created?.let(onCreated) }

    state.conflict?.let { conflict ->
        SlotConflictScreen(
            error = conflict,
            clock = clock,
            staffName = { id -> state.staff.valueOrNull?.firstOrNull { it.id == id }?.userFullName ?: "Personel" },
            onPick = viewModel::applySuggestion,
            onBack = viewModel::dismissConflict,
            modifier = modifier,
        )
        return
    }

    Box {
        KlinaraScreen(
            title = if (state.draft.isRescheduling) "Randevuyu ertele" else "Yeni randevu",
            onBack = onBack,
            modifier = modifier,
        ) {
            state.error?.let {
                ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError)
            }

            CustomerSection(state, viewModel)

            if (state.draft.canEditLineup) {
                ServicesSection(state, viewModel)
            } else {
                LockedLineupNote(state)
            }

            // Bölümler ilerledikçe açılır: hizmet seçilmeden personel ve slot sormak,
            // cevaplanamayacak sorular sormaktır.
            if (state.draft.canQueryAvailability) {
                StaffSection(state, viewModel)
                SlotSection(state, viewModel, clock)
                SummarySection(state, clock)
            }

            NotesSection(state, viewModel)

            KlinaraButton(
                title = if (state.draft.isRescheduling) "Ertele" else "Oluştur",
                onClick = viewModel::save,
                enabled = state.draft.isValid && !state.isSaving,
                isLoading = state.isSaving,
            )
            state.draft.missingStepsHint?.takeIf { !state.isSaving }?.let { hint ->
                Text(
                    hint,
                    style = KlinaraType.bodyM,
                    color = KlinaraTheme.colors.charcoalMuted,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }
}

@Composable
private fun CustomerSection(
    state: BookingUiState,
    viewModel: BookingFlowViewModel,
) {
    val selected = state.customers.firstOrNull { it.id == state.draft.customerId }
    val focusManager = LocalFocusManager.current

    KlinaraCard(title = "Müşteri") {
        if (!state.draft.canEditLineup) {
            // Erteleme müşteriyi KİLİTLER: erteleme saati değiştirir, müşteriyi değil.
            Text(
                selected?.fullName ?: "Müşteri",
                style = KlinaraType.bodyEmphasis,
                color = KlinaraTheme.colors.charcoal,
            )
            return@KlinaraCard
        }

        // Seçim yapıldıysa arama alanı yerine seçili müşteri gösterilir (web paneli ve
        // iOS ile aynı desen). Alanı seçili adla doldurmak kötü olurdu: kullanıcı yazmaya
        // başladığında seçimin hâlâ geçerli olup olmadığı belirsizleşir.
        if (selected != null) {
            SelectedCustomerRow(
                name = selected.fullName,
                phone = selected.phone,
                onChange = viewModel::clearCustomer,
            )
            return@KlinaraCard
        }

        KlinaraTextField(
            label = "Müşteri ara",
            value = state.customerQuery,
            onValueChange = viewModel::searchCustomers,
            placeholder = "Ad ya da telefon",
        )
        if (state.customerQuery.isNotBlank()) {
            state.customers.forEachIndexed { index, customer ->
                if (index > 0) KlinaraDivider()
                SelectableRow(
                    title = customer.fullName,
                    detail = customer.phone,
                    isSelected = false,
                    onClick = {
                        // Arama alanı seçimle kalkıyor; klavye açık kalmasın.
                        focusManager.clearFocus()
                        viewModel.selectCustomer(customer.id)
                    },
                )
            }
        }
    }
}

@Composable
private fun SelectedCustomerRow(
    name: String,
    phone: String?,
    onChange: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        Box(
            modifier =
                Modifier
                    .size(40.dp)
                    .background(colors.sageSoft, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                name.split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1) }.uppercase(),
                style = KlinaraType.bodyEmphasis,
                color = colors.sageDeep,
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(name, style = KlinaraType.bodyEmphasis, color = colors.charcoal)
            phone?.let { Text(it, style = KlinaraType.bodyM, color = colors.charcoalMuted) }
        }
        Text(
            "Değiştir",
            style = KlinaraType.bodyEmphasis,
            color = colors.sageDeep,
            modifier =
                Modifier
                    .klinaraClickable(
                        enabled = true,
                        role = Role.Button,
                        interactionSource = interaction,
                        onClick = onChange,
                    ).padding(horizontal = KlinaraMetrics.xs, vertical = KlinaraMetrics.sm),
        )
    }
}

@Composable
private fun ServicesSection(
    state: BookingUiState,
    viewModel: BookingFlowViewModel,
) {
    KlinaraCard(title = "Hizmetler", footnote = "Sıra önemlidir: hizmetler seçtiğiniz sırayla uygulanır.") {
        when (state.services) {
            Loadable.Loading -> KlinaraSkeletonSection()
            is Loadable.Failed -> ErrorBanner(message = state.services.message)
            is Loadable.Loaded ->
                state.activeServices.forEachIndexed { index, service ->
                    if (index > 0) KlinaraDivider()
                    val order = state.draft.serviceIds.indexOf(service.id)
                    val effective = service.effective(state.draft.branchId)
                    SelectableRow(
                        title = service.name,
                        detail =
                            DurationFormat.format(effective.durationMinutes) +
                                " · " + Money.format(effective.priceMinor),
                        isSelected = order >= 0,
                        badge = if (order >= 0) "${order + 1}" else null,
                        onClick = { viewModel.toggleService(service.id) },
                    )
                }
        }
    }
}

@Composable
private fun LockedLineupNote(state: BookingUiState) {
    KlinaraCard(title = "Hizmetler", footnote = "Erteleme yalnız saati değiştirir.") {
        val names = state.services.valueOrNull.orEmpty().associateBy { it.id }
        state.draft.serviceIds.forEach { id ->
            Text(
                names[id]?.name ?: "Hizmet",
                style = KlinaraType.bodyEmphasis,
                color = KlinaraTheme.colors.charcoal,
            )
        }
    }
}

@Composable
private fun StaffSection(
    state: BookingUiState,
    viewModel: BookingFlowViewModel,
) {
    val eligible = state.eligibleStaff
    KlinaraCard(
        title = "Personel",
        footnote =
            NARROWED_STAFF_NOTE.takeIf {
                eligible.size < state.staff.valueOrNull.orEmpty().count { it.isActive }
            },
    ) {
        if (eligible.isEmpty()) {
            Text(
                "Bu hizmet birleşimini verebilecek personel yok.",
                style = KlinaraType.bodyM,
                color = KlinaraTheme.colors.charcoalMuted,
            )
            return@KlinaraCard
        }
        eligible.forEachIndexed { index, profile ->
            if (index > 0) KlinaraDivider()
            SelectableRow(
                title = profile.userFullName,
                detail = profile.title,
                isSelected = profile.id == state.draft.staffProfileId,
                onClick = { viewModel.selectStaff(profile.id.takeIf { it != state.draft.staffProfileId }) },
            )
        }
    }
}

@Composable
private fun SlotSection(
    state: BookingUiState,
    viewModel: BookingFlowViewModel,
    clock: BranchClock,
) {
    KlinaraCard(title = "Saat") {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            DayStep(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Önceki gün") { viewModel.stepDay(-1) }
            // Başlık takvimi açıyor: haftalar sonrası için ok tuşuyla gün gün ilerlemek
            // zahmetliydi. Oklar yakın günler için duruyor.
            var picking by remember { mutableStateOf(false) }
            val (title, prefix) = clock.dayPickerLabel(state.day)
            val dayInteraction = remember { MutableInteractionSource() }
            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .heightIn(min = 44.dp)
                        .klinaraClickable(
                            enabled = true,
                            role = Role.Button,
                            interactionSource = dayInteraction,
                            onClick = { picking = true },
                        ).semantics(mergeDescendants = true) {
                            contentDescription = listOfNotNull(prefix, title, "takvimden gün seçin").joinToString(", ")
                        },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                prefix?.let {
                    Text(it, style = KlinaraType.label, color = KlinaraTheme.colors.charcoalMuted)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(title, style = KlinaraType.bodyEmphasis, color = KlinaraTheme.colors.charcoal)
                    Icon(
                        imageVector = Icons.Filled.DateRange,
                        contentDescription = null,
                        tint = KlinaraTheme.colors.sageDeep,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            if (picking) {
                BookingDayPickerDialog(
                    initial = clock.localDate(state.day),
                    today = clock.localDate(java.time.Instant.now()),
                    days = state.calendarDays,
                    onMonth = viewModel::loadCalendarMonth,
                    onPick = { date ->
                        viewModel.selectDay(date)
                        picking = false
                    },
                    onDismiss = { picking = false },
                )
            }
            DayStep(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Sonraki gün") { viewModel.stepDay(1) }
        }

        when (state.slots) {
            Loadable.Loading -> KlinaraSkeletonChips()

            is Loadable.Failed -> ErrorBanner(message = state.slots.message)

            is Loadable.Loaded -> {
                AvailabilityPresentation.openDayNote(state.dayInfo)?.let { note ->
                    Text(note, style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
                }
                if (state.visibleSlots.isEmpty()) {
                    EmptyDay(AvailabilityPresentation.emptyNotice(state.dayInfo)) { viewModel.stepDay(1) }
                } else {
                    SlotGrid(state, viewModel, clock)
                }
            }
        }
    }
}

@Composable
private fun EmptyDay(
    notice: AvailabilityPresentation.Notice,
    onNextDay: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember { MutableInteractionSource() }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .border(KlinaraMetrics.borderWidth, colors.border, RoundedCornerShape(KlinaraMetrics.controlRadius))
                .padding(vertical = KlinaraMetrics.lg, horizontal = KlinaraMetrics.md),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        Icon(
            imageVector = Icons.Filled.DateRange,
            contentDescription = null,
            tint = colors.charcoalMuted,
        )
        Text(
            notice.title,
            style = KlinaraType.bodyEmphasis,
            color = colors.charcoal,
            textAlign = TextAlign.Center,
        )
        Text(
            notice.detail,
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
            textAlign = TextAlign.Center,
        )
        if (notice.suggestsNextDay) {
            Text(
                "Sonraki gün →",
                style = KlinaraType.bodyEmphasis,
                color = colors.sageDeep,
                modifier =
                    Modifier
                        .klinaraClickable(
                            enabled = true,
                            role = Role.Button,
                            interactionSource = interaction,
                            onClick = onNextDay,
                        ).padding(vertical = KlinaraMetrics.sm, horizontal = KlinaraMetrics.md),
            )
        }
    }
}

/**
 * Uygun saatler — sabah / öğleden sonra / akşam gruplarında, EŞİT sütunlu ızgara.
 *
 * Eskiden `FlowRow` + yuvarlak çip vardı: çiplerin genişliği metne göre değiştiği için
 * satırlar düzensiz sarıyor, sağda boşluk kalıyordu. Saatler aynı uzunlukta metinler;
 * eşit sütun hem kenardan kenara dolduruyor hem de sütun boyunca taramayı kolaylaştırıyor.
 */
@Composable
private fun SlotGrid(
    state: BookingUiState,
    viewModel: BookingFlowViewModel,
    clock: BranchClock,
) {
    val colors = KlinaraTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md)) {
        AvailabilityPresentation.group(state.visibleSlots, clock).forEach { group ->
            Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
                Text(
                    "${group.period.title.uppercase(TrLocale)} · ${group.slots.size}",
                    style = KlinaraType.label,
                    color = colors.charcoalMuted,
                    modifier = Modifier.semantics { heading() },
                )
                // Kaydırılan sayfanın içinde: Lazy ızgara iç içe kaydırma çakışması
                // yaratırdı; slot sayısı bir günde en fazla birkaç düzine.
                group.slots.chunked(SLOT_COLUMNS).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
                        row.forEach { slot -> SlotChip(slot, state, viewModel, clock, Modifier.weight(1f)) }
                        repeat(SLOT_COLUMNS - row.size) { Box(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun SlotChip(
    slot: AvailabilitySlot,
    state: BookingUiState,
    viewModel: BookingFlowViewModel,
    clock: BranchClock,
    modifier: Modifier,
) {
    val colors = KlinaraTheme.colors
    val isSelected = state.draft.slot?.startsAt == slot.startsAt
    val interaction = remember(slot.startsAt) { MutableInteractionSource() }
    val shape = RoundedCornerShape(KlinaraMetrics.controlRadius)
    val label =
        buildString {
            append(clock.formatTime(slot.startsAt))
            if (slot.staffProfileIds.size > 1) append(", ${slot.staffProfileIds.size} kişi uygun")
        }
    Column(
        modifier =
            modifier
                .heightIn(min = 44.dp)
                .background(if (isSelected) colors.sageDeep else colors.surfaceRaised, shape)
                .border(
                    KlinaraMetrics.borderWidth,
                    if (isSelected) colors.sageDeep else colors.border,
                    shape,
                ).klinaraClickable(
                    enabled = true,
                    role = Role.Button,
                    interactionSource = interaction,
                    onClick = { viewModel.selectSlot(slot) },
                ).clearAndSetSemantics {
                    contentDescription = label
                    selected = isSelected
                    role = Role.Button
                },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            clock.formatTime(slot.startsAt),
            style = KlinaraType.bodyEmphasis,
            color = if (isSelected) colors.surfaceRaised else colors.charcoal,
            maxLines = 1,
        )
        if (slot.staffProfileIds.size > 1) {
            Text(
                "${slot.staffProfileIds.size} kişi",
                style = KlinaraType.bodyM.copy(fontSize = 11.sp, lineHeight = 13.sp),
                color = if (isSelected) colors.surfaceRaised.copy(alpha = 0.8f) else colors.charcoalMuted,
            )
        }
    }
}

@Composable
private fun SummarySection(
    state: BookingUiState,
    clock: BranchClock,
) {
    val slot = state.draft.slot ?: return
    val services = state.services.valueOrNull.orEmpty()

    KlinaraCard(title = "Özet") {
        Text(
            "${clock.formatDate(slot.startsAt)} · ${clock.formatRange(slot.startsAt, slot.endsAt)}",
            style = KlinaraType.bodyEmphasis,
            color = KlinaraTheme.colors.charcoal,
        )
        Text(
            "${DurationFormat.format(state.draft.visibleMinutes(services))} · " +
                Money.format(state.draft.totalMinor(services)),
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.charcoalMuted,
        )
    }
}

@Composable
private fun NotesSection(
    state: BookingUiState,
    viewModel: BookingFlowViewModel,
) {
    if (state.draft.isRescheduling) {
        KlinaraCard(title = "Erteleme sebebi") {
            KlinaraTextField(
                label = "Sebep (isteğe bağlı)",
                value = state.draft.reason,
                onValueChange = viewModel::setReason,
                placeholder = "Müşteri talebi…",
            )
        }
    } else {
        KlinaraCard(title = "Not") {
            KlinaraTextField(
                label = "Not (isteğe bağlı)",
                value = state.draft.notes,
                onValueChange = viewModel::setNotes,
                placeholder = "Bu randevuya dair not…",
            )
            KlinaraDivider()
            KlinaraToggleRow(
                label = "Müşteriye bildir",
                detail = "Müşteriye WhatsApp ile randevu onayı gönderilir.",
                isOn = state.draft.notifyCustomer,
                onToggle = viewModel::setNotifyCustomer,
            )
        }
    }
}

@Composable
private fun SelectableRow(
    title: String,
    detail: String?,
    isSelected: Boolean,
    onClick: () -> Unit,
    badge: String? = null,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember(title) { MutableInteractionSource() }
    val label = listOfNotNull(title, detail).joinToString(", ")

    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .klinaraClickable(
                    enabled = true,
                    role = Role.Button,
                    interactionSource = interaction,
                    onClick = onClick,
                ).clearAndSetSemantics {
                    contentDescription = label
                    selected = isSelected
                    role = Role.Button
                }.padding(vertical = KlinaraMetrics.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                style = KlinaraType.bodyEmphasis,
                color = if (isSelected) colors.sageDeep else colors.charcoal,
            )
            detail?.let { Text(it, style = KlinaraType.bodyM, color = colors.charcoalMuted) }
        }
        // Sıra numarası: hizmetlerin UYGULANMA sırası, seçim sırası değil — ve o sıra
        // sunucuya aynen gidiyor.
        badge?.let { KlinaraBadge(text = it) }
    }
}

@Composable
private fun DayStep(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    val interaction = remember(label) { MutableInteractionSource() }
    Box(
        modifier =
            Modifier
                .size(KlinaraMetrics.minTouchTarget)
                .klinaraClickable(
                    enabled = true,
                    role = Role.Button,
                    interactionSource = interaction,
                    onClick = onClick,
                ).clearAndSetSemantics {
                    contentDescription = label
                    role = Role.Button
                },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = KlinaraTheme.colors.charcoal)
    }
}

/** Rezervasyon giriş noktası bu izne bağlı; `Permissions` sabiti tek kaynak. */
internal val BOOKING_PERMISSION = Permissions.APPOINTMENT_WRITE

private const val NARROWED_STAFF_NOTE =
    "Yalnız seçtiğiniz hizmetlerin HEPSİNDE yetkin personel listeleniyor."

private const val SLOT_COLUMNS = 4
