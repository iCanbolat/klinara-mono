package com.klinara.android.features.calendar.booking

import androidx.compose.foundation.background
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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

        KlinaraTextField(
            label = "Müşteri ara",
            value = state.customerQuery,
            onValueChange = viewModel::searchCustomers,
            placeholder = "Ad ya da telefon",
        )
        state.customers.forEachIndexed { index, customer ->
            if (index > 0) KlinaraDivider()
            SelectableRow(
                title = customer.fullName,
                detail = customer.phone,
                isSelected = customer.id == state.draft.customerId,
                onClick = { viewModel.selectCustomer(customer.id) },
            )
        }
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
            Text(
                clock.formatDate(state.day),
                style = KlinaraType.bodyEmphasis,
                color = KlinaraTheme.colors.charcoal,
                modifier = Modifier.weight(1f),
            )
            DayStep(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Sonraki gün") { viewModel.stepDay(1) }
        }

        when (state.slots) {
            Loadable.Loading -> KlinaraSkeletonChips()

            is Loadable.Failed -> ErrorBanner(message = state.slots.message)

            is Loadable.Loaded ->
                if (state.visibleSlots.isEmpty()) {
                    Text(
                        "Bu günde uygun saat yok. Başka bir gün deneyin.",
                        style = KlinaraType.bodyM,
                        color = KlinaraTheme.colors.charcoalMuted,
                    )
                } else {
                    SlotGrid(state, viewModel, clock)
                }
        }
    }
}

@Composable
private fun SlotGrid(
    state: BookingUiState,
    viewModel: BookingFlowViewModel,
    clock: BranchClock,
) {
    val colors = KlinaraTheme.colors
    // Basit bir sarmalayan ızgara: `KlinaraChipGrid` A0.3'te yazılmadı ve tek çağıranı
    // burası; genel bir bileşen kurmak için ikinci bir çağıran beklenir.
    androidx.compose.foundation.layout.FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        state.visibleSlots.forEach { slot ->
            val isSelected = state.draft.slot?.startsAt == slot.startsAt
            val interaction = remember(slot.startsAt) { MutableInteractionSource() }
            val label =
                buildString {
                    append(clock.formatTime(slot.startsAt))
                    if (slot.staffProfileIds.size > 1) append(", ${slot.staffProfileIds.size} kişi uygun")
                }
            Row(
                modifier =
                    Modifier
                        .background(if (isSelected) colors.sageDeep else colors.surfaceRaised, CircleShape)
                        .border(
                            if (isSelected) KlinaraMetrics.focusBorderWidth else KlinaraMetrics.borderWidth,
                            if (isSelected) colors.sageDeep else colors.border,
                            CircleShape,
                        ).klinaraClickable(
                            enabled = true,
                            role = Role.Button,
                            interactionSource = interaction,
                            onClick = { viewModel.selectSlot(slot) },
                        ).clearAndSetSemantics {
                            contentDescription = label
                            selected = isSelected
                            role = Role.Button
                        }.padding(horizontal = KlinaraMetrics.sm, vertical = CHIP_PADDING),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
            ) {
                Text(
                    clock.formatTime(slot.startsAt),
                    style = KlinaraType.bodyM,
                    color = if (isSelected) colors.surfaceRaised else colors.charcoal,
                    maxLines = 1,
                )
                if (slot.staffProfileIds.size > 1) {
                    KlinaraBadge(text = "${slot.staffProfileIds.size}")
                }
            }
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

private val CHIP_PADDING = 6.dp
