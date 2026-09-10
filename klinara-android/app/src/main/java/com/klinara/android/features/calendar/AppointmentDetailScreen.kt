package com.klinara.android.features.calendar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.ColorDot
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.booking.Appointment
import com.klinara.android.services.booking.AppointmentOrigin
import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.DurationFormat
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.networking.Loadable

/**
 * Randevu detayı.
 *
 * **Bir `NavHost` hedefi, bir sheet DEĞİL** (§5.3, Kural 2): bilgi mimarisi iOS ile aynı
 * ama etkileşim deyimi Android'in — tahmini geri (predictive back) ve sistem geri tuşu
 * bedava geliyor ve A2.1'de sekme başına kurulan geri yığını tam bunun için vardı.
 *
 * Ekran takvim satırıyla yetinmez, `GET appointments/:id` çağırır: `origin`,
 * `cancellationReason` ve tampon süreleri yalnız orada ve `If-Match` taze bir sürüm ister.
 */
@Composable
fun AppointmentDetailScreen(
    appointmentId: String,
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    onOpenHistory: (String) -> Unit,
    onReschedule: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val clock = remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }
    val viewModel: AppointmentDetailViewModel =
        viewModel(
            key = "appointment-$appointmentId",
            factory = AppointmentDetailViewModel.factory(container, appointmentId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(appointmentId) { viewModel.load() }

    Box {
        KlinaraScreen(title = "Randevu", onBack = onBack, modifier = modifier) {
            state.error?.let { message ->
                ErrorBanner(message = message, retryLabel = "Kapat", onRetry = viewModel::dismissError)
            }

            when (val appointment = state.appointment) {
                Loadable.Loading ->
                    Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)

                is Loadable.Failed ->
                    ErrorBanner(
                        message = appointment.message,
                        onRetry = if (appointment.isRetryable) viewModel::load else null,
                    )

                is Loadable.Loaded ->
                    DetailBody(
                        appointment = appointment.value,
                        state = state,
                        session = session,
                        clock = clock,
                        viewModel = viewModel,
                        onOpenHistory = onOpenHistory,
                        onReschedule = onReschedule,
                    )
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }

    state.pendingStatus?.let { status ->
        StatusConfirmDialog(
            status = status,
            onConfirm = viewModel::confirmStatus,
            onDismiss = viewModel::cancelStatusPrompt,
        )
    }
}

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.DetailBody(
    appointment: Appointment,
    state: AppointmentDetailUiState,
    session: AppSession,
    clock: BranchClock,
    viewModel: AppointmentDetailViewModel,
    onOpenHistory: (String) -> Unit,
    onReschedule: (String) -> Unit,
) {
    val canWrite = session.can(Permissions.APPOINTMENT_WRITE)
    val canReopen = session.can(Permissions.APPOINTMENT_REOPEN)

    SummaryCard(appointment, state, clock)
    ServicesCard(appointment, state, clock)
    NotesCard(appointment, canWrite, viewModel)

    // Aksiyon kartı YALNIZ yetkiliye çizilir (§7.4): yetkisi olmayana düğmeyi gösterip
    // içeride 403 vermek, ona yapamayacağı bir şeyi vaat etmektir.
    if (canWrite) {
        ActionsCard(appointment, canReopen, viewModel)

        // Erteleme kapanmış randevularda yok: sunucu `assertMutable` ile reddediyor
        // ve reddedilecek bir düğme göstermek, yapılamayacak bir şeyi vaat etmektir.
        if (appointment.status.canReschedule) {
            KlinaraCard(title = "Erteleme") {
                KlinaraButton(
                    title = "Saati değiştir",
                    onClick = { onReschedule(appointment.id) },
                    kind = KlinaraButtonKind.Secondary,
                )
            }
        }
    }

    KlinaraCard {
        KlinaraNavigationRow(label = "Geçmiş", onClick = { onOpenHistory(appointment.id) })
    }
}

@Composable
private fun SummaryCard(
    appointment: Appointment,
    state: AppointmentDetailUiState,
    clock: BranchClock,
) {
    KlinaraCard {
        // Müşteri satırı EN ÜSTTE: "kim geliyor" bu ekranın ilk sorusu. Müşteri
        // çağrısı düşerse satır bir yer tutucuya iner ama randevu bilgisi kalır.
        when (val customer = state.customer) {
            is Loadable.Loaded -> {
                Text(
                    customer.value.fullName,
                    style = KlinaraType.titleM,
                    color = KlinaraTheme.colors.charcoal,
                )
                customer.value.phone?.let {
                    Text(it, style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
                }
            }

            is Loadable.Failed ->
                Text(
                    "Müşteri bilgisi yüklenemedi",
                    style = KlinaraType.bodyM,
                    color = KlinaraTheme.colors.charcoalMuted,
                )

            Loadable.Loading ->
                Text("Müşteri yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
        }

        KlinaraDivider()

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    clock.formatRange(appointment.startsAt, appointment.endsAt),
                    style = KlinaraType.bodyL,
                    color = KlinaraTheme.colors.charcoal,
                )
                Text(
                    clock.formatDate(appointment.startsAt),
                    style = KlinaraType.bodyM,
                    color = KlinaraTheme.colors.charcoalMuted,
                )
            }
            KlinaraBadge(text = appointment.status.turkishName, tone = appointment.status.badgeTone)
        }

        KlinaraDivider()
        KlinaraRow(label = "Tutar", value = Money.format(appointment.totalMinor))

        // "Kaynak" satırı YALNIZ online randevuda: klinikte açılmış bir randevuda
        // "Kaynak: Klinik" demek, hiçbir soruyu cevaplamayan bir satır olurdu.
        if (appointment.origin == AppointmentOrigin.Online) {
            KlinaraRow(label = "Kaynak", value = appointment.origin.turkishName)
        }
        appointment.cancellationReason?.let { KlinaraRow(label = "İptal sebebi", value = it) }
    }
}

@Composable
private fun ServicesCard(
    appointment: Appointment,
    state: AppointmentDetailUiState,
    clock: BranchClock,
) {
    KlinaraCard(title = "Hizmetler", footnote = occupiedFootnote(appointment)) {
        appointment.services.sortedBy { it.sortOrder }.forEachIndexed { index, line ->
            if (index > 0) KlinaraDivider()
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            ) {
                ColorDot(
                    color =
                        accentColor(
                            state.staffColor(line.staffProfileId),
                            KlinaraTheme.colors.sage,
                        ),
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        state.staffName(line.staffProfileId),
                        style = KlinaraType.bodyEmphasis,
                        color = KlinaraTheme.colors.charcoal,
                    )
                    val range = clock.formatRange(line.startsAt, line.endsAt)
                    Text(
                        "$range · ${DurationFormat.format(line.durationMinutes)}",
                        style = KlinaraType.bodyM,
                        color = KlinaraTheme.colors.charcoalMuted,
                    )
                }
                Text(
                    Money.format(line.priceMinor),
                    style = KlinaraType.bodyM,
                    color = KlinaraTheme.colors.charcoal,
                )
            }
        }
    }
}

/**
 * Tamponlar `appointments` tablosunda değil `resource_bookings.time_range`'de yaşıyor:
 * müşteri 14:00 görür, takvim 13:55–15:10 tutar. Bu farkı söylememek, "boş görünen" bir
 * aralığa randevu verilmeye çalışılmasına yol açar.
 */
private fun occupiedFootnote(appointment: Appointment): String? {
    val visible = appointment.visibleMinutes
    val occupied = appointment.occupiedMinutes
    if (occupied <= visible) return null
    return "Takvimde ${DurationFormat.format(occupied)} yer tutuyor " +
        "(${DurationFormat.format(visible)} işlem + hazırlık payı)."
}

@Composable
private fun NotesCard(
    appointment: Appointment,
    canWrite: Boolean,
    viewModel: AppointmentDetailViewModel,
) {
    var draft by rememberSaveable(appointment.id, appointment.version) {
        mutableStateOf(appointment.notes.orEmpty())
    }
    val isDirty = draft.trim() != appointment.notes.orEmpty()

    KlinaraCard(
        title = "Not",
        // Kullanıcı alanı temizleyip kaydettiğinde notun SİLİNECEĞİNİ önceden bilmeli;
        // sonradan öğrenmek, geri alınamayan bir sürprizdir.
        footnote = "Alanı boş bırakıp kaydederseniz not silinir.".takeIf { canWrite },
    ) {
        KlinaraTextField(
            label = "Not",
            value = draft,
            onValueChange = { draft = it },
            placeholder = "Bu randevuya dair not…",
            enabled = canWrite,
        )
        if (canWrite) {
            KlinaraButton(
                title = "Notu kaydet",
                onClick = { viewModel.saveNotes(draft) },
                kind = KlinaraButtonKind.Secondary,
                enabled = isDirty,
            )
        }
    }
}

@Composable
private fun ActionsCard(
    appointment: Appointment,
    canReopen: Boolean,
    viewModel: AppointmentDetailViewModel,
) {
    val transitions = appointment.status.allowedTransitions(canReopen)
    var isCancelling by rememberSaveable { mutableStateOf(false) }
    var reason by rememberSaveable { mutableStateOf("") }

    if (transitions.isNotEmpty()) {
        KlinaraCard(title = "Durum") {
            transitions.forEachIndexed { index, status ->
                if (index > 0) KlinaraDivider()
                KlinaraNavigationRow(
                    label = status.turkishName,
                    onClick = { viewModel.askStatus(status) },
                )
            }
        }
    }

    if (!appointment.status.isTerminal) {
        KlinaraCard(title = "İptal") {
            if (isCancelling) {
                KlinaraTextField(
                    label = "İptal sebebi (isteğe bağlı)",
                    value = reason,
                    onValueChange = { reason = it },
                    placeholder = "Müşteri erteleme istedi…",
                )
                KlinaraButton(
                    title = "İptali onayla",
                    onClick = {
                        viewModel.cancelAppointment(reason)
                        isCancelling = false
                        reason = ""
                    },
                    kind = KlinaraButtonKind.Tertiary,
                )
            } else {
                KlinaraButton(
                    title = "Randevuyu iptal et",
                    onClick = { isCancelling = true },
                    kind = KlinaraButtonKind.Tertiary,
                )
            }
        }
    }
}

@Composable
private fun StatusConfirmDialog(
    status: AppointmentStatus,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Durum güncellensin mi?", style = KlinaraType.titleM) },
        text = {
            Text(
                "Randevu \"${status.turkishName}\" olarak işaretlenecek.",
                style = KlinaraType.bodyM,
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Güncelle") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Vazgeç") } },
        containerColor = KlinaraTheme.colors.surfaceRaised,
    )
}
