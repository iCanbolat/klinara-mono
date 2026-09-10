package com.klinara.android.features.customers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
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
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.NotificationChannel
import com.klinara.android.services.notifications.OptOutRecord

/**
 * İletişim tercihi bölümü.
 *
 * **`notification:read` yoksa HİÇ ÇİZİLMEZ** (çağıran karar veriyor); `:manage` yoksa
 * okunur ama değiştirilemez.
 *
 * Bölümün en önemli işi bir yanlış anlamayı önlemek: rızanın geri alınması **yalnız
 * ticari iletileri** durdurur. Randevu onayı ve hatırlatması işlemsel iletidir ve
 * gitmeye devam eder. Bunu söylemeyen bir ekran, personele "müşteriye artık hiçbir şey
 * ulaşmayacak" dedirtir.
 */
@Composable
fun CustomerOptOutSection(
    session: AppSession,
    container: ServiceContainer,
    customerId: String,
    clock: BranchClock,
    modifier: Modifier = Modifier,
) {
    val viewModel: CustomerOptOutViewModel =
        viewModel(
            key = "customer-optout-$customerId",
            factory = CustomerOptOutViewModel.factory(container, customerId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canManage = session.can(Permissions.NOTIFICATION_MANAGE)

    // Kartın açılışını bloklamaz: kendi `LaunchedEffect`i var, kendi hatası var.
    LaunchedEffect(customerId) { viewModel.load() }

    KlinaraCard(
        title = "İletişim tercihi",
        footnote =
            "Reddedilen yalnız ticari iletilerdir. Randevu onayı ve hatırlatması " +
                "işlemsel ileti sayılır ve gönderilmeye devam eder.",
        modifier = modifier,
    ) {
        state.error?.let {
            ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError)
        }

        when (val records = state.records) {
            Loadable.Loading ->
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)

            is Loadable.Failed ->
                ErrorBanner(
                    message = records.message,
                    onRetry = if (records.isRetryable) viewModel::load else null,
                )

            is Loadable.Loaded ->
                OptOutBody(
                    records = records.value,
                    blocksEverything = state.blocksEverything,
                    canManage = canManage,
                    isSaving = state.isSaving,
                    clock = clock,
                    onOptOutAll = { viewModel.optOut(null) },
                    onRevokeAll = { viewModel.revoke(null) },
                )
        }
    }
}

@Composable
private fun OptOutBody(
    records: List<OptOutRecord>,
    blocksEverything: Boolean,
    canManage: Boolean,
    isSaving: Boolean,
    clock: BranchClock,
    onOptOutAll: () -> Unit,
    onRevokeAll: () -> Unit,
) {
    val colors = KlinaraTheme.colors

    if (records.isEmpty()) {
        KlinaraRow(label = "Durum", value = "Ticari iletilere izin veriliyor")
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
            records.forEach { record ->
                KlinaraRow(
                    // `channel == null` "TÜM kanallar" demek — "bilinmiyor" değil.
                    label = record.channelLabel,
                    value = record.source?.turkishName,
                    detail = record.createdAt?.let(clock::formatDateTime),
                    accessory = { KlinaraBadge(text = "Kapalı", tone = KlinaraBadgeTone.Warning) },
                )
            }
        }
    }

    if (!canManage) {
        Text(
            "İletişim tercihini değiştirmek için bildirim yönetimi yetkisi gerekir.",
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
        )
        return
    }

    if (blocksEverything) {
        KlinaraButton(
            title = "İzni geri ver",
            onClick = onRevokeAll,
            kind = KlinaraButtonKind.Secondary,
            isLoading = isSaving,
            modifier = Modifier.fillMaxWidth(),
        )
    } else {
        KlinaraButton(
            title = "Tüm ticari iletileri kapat",
            onClick = onOptOutAll,
            // Yıkıcı bir eylem DEĞİL: "İzni geri ver" ile dönülebiliyor. Kırmızı bir
            // düğme, geri alınabilir bir tercihi kalıcı bir kayıp gibi gösterirdi.
            kind = KlinaraButtonKind.Secondary,
            isLoading = isSaving,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** Kanal listesi A8.2'de kanal bazlı kontrole dönüşecek; bugün kapsam "tümü". */
internal val OPT_OUT_CHANNELS: List<NotificationChannel> = NotificationChannel.selectable
