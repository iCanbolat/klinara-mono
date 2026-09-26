package com.klinara.android.features.conversations

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraOverflowMenu
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.conversations.Conversation
import com.klinara.android.services.conversations.ConversationDetail
import com.klinara.android.services.conversations.ConversationFormat
import com.klinara.android.services.conversations.ConversationMessage
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.MessageStatus
import java.time.Instant

/**
 * Tek sohbetin akışı — iOS `ConversationThreadView` paritesi.
 *
 * Alt çubuk üç hâlden birindedir: pencere açık → serbest metin; pencere kapalı → uyarı ve
 * "Şablon gönder"; sohbet kapatılmış → bilgi metni (üst menüden yeniden açılır).
 */
@Composable
fun ConversationThreadScreen(
    session: AppSession,
    container: ServiceContainer,
    conversationId: String,
    onBack: () -> Unit,
    onOpenCustomer: ((String) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val viewModel: ConversationThreadViewModel =
        viewModel(
            key = "conversation-$conversationId",
            factory = ConversationThreadViewModel.factory(container, conversationId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val template by viewModel.template.collectAsStateWithLifecycle()
    val clock = remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }
    var showsLink by rememberSaveable { mutableStateOf(false) }
    val lifecycleOwner = LocalLifecycleOwner.current

    LaunchedEffect(viewModel) {
        viewModel.load()
        // Yalnız ekran görünürken yokla; arka planda pil boşuna tükenmesin.
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) { viewModel.poll() }
    }

    val conversation = state.conversation
    KlinaraScreen(
        title = conversation?.title ?: "Sohbet",
        modifier = modifier,
        onBack = onBack,
        scrollable = false,
        contentPadding = PaddingValues(0.dp),
        verticalSpacing = 0.dp,
        trailing = {
            if (conversation != null) {
                ThreadMenu(
                    conversation = conversation,
                    canReadCustomer = session.can(Permissions.CUSTOMER_READ),
                    busy = state.isUpdatingStatus,
                    onOpenCustomer = onOpenCustomer,
                    onLink = { showsLink = true },
                    onSetClosed = viewModel::setClosed,
                )
            }
        },
    ) {
        when (val detail = state.detail) {
            Loadable.Loading ->
                KlinaraSkeleton(
                    style = KlinaraSkeletonStyle.cards,
                    modifier = Modifier.padding(KlinaraMetrics.screenInset),
                )
            is Loadable.Failed ->
                ErrorBanner(
                    message = detail.message,
                    onRetry = if (detail.isRetryable) viewModel::load else null,
                    modifier = Modifier.padding(KlinaraMetrics.screenInset),
                )
            is Loadable.Loaded -> {
                Box(Modifier.weight(1f)) {
                    Thread(detail.value, clock, state.actionError, viewModel::dismissError)
                }
                BottomBar(detail.value.conversation, state, viewModel)
            }
        }
    }

    template?.let { TemplateSendSheet(it, viewModel) }
    if (showsLink) {
        LinkCustomerSheet(
            container = container,
            onPick = {
                viewModel.linkCustomer(it)
                showsLink = false
            },
            onDismiss = { showsLink = false },
        )
    }
}

@Composable
private fun ThreadMenu(
    conversation: Conversation,
    canReadCustomer: Boolean,
    busy: Boolean,
    onOpenCustomer: ((String) -> Unit)?,
    onLink: () -> Unit,
    onSetClosed: (Boolean) -> Unit,
) {
    val colors = KlinaraTheme.colors
    KlinaraOverflowMenu { dismiss ->
        val customer = conversation.customer
        if (customer != null && onOpenCustomer != null) {
            DropdownMenuItem(
                text = { Text("Müşteri kartını aç", style = KlinaraType.bodyL, color = colors.charcoal) },
                onClick = {
                    dismiss()
                    onOpenCustomer(customer.id)
                },
            )
        } else if (customer == null && canReadCustomer) {
            DropdownMenuItem(
                text = { Text("Müşteriye bağla", style = KlinaraType.bodyL, color = colors.charcoal) },
                onClick = {
                    dismiss()
                    onLink()
                },
            )
        }
        DropdownMenuItem(
            text = {
                Text(
                    if (conversation.isClosed) "Yeniden aç" else "Sohbeti kapat",
                    style = KlinaraType.bodyL,
                    color = colors.charcoal,
                )
            },
            enabled = !busy,
            onClick = {
                dismiss()
                onSetClosed(!conversation.isClosed)
            },
        )
    }
}

@Composable
private fun Thread(
    detail: ConversationDetail,
    clock: BranchClock,
    actionError: String?,
    onDismissError: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val listState = rememberLazyListState()
    val groups = remember(detail.messages, clock) { detail.messages.groupBy { clock.startOfDay(it.createdAt) } }
    val lastId = detail.messages.lastOrNull()?.id

    // Yeni mesajda (ve açılışta) en alta.
    LaunchedEffect(lastId) {
        val total = listState.layoutInfo.totalItemsCount
        if (total > 0) listState.animateScrollToItem(total - 1)
    }

    LazyColumn(
        state = listState,
        contentPadding = PaddingValues(KlinaraMetrics.md),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        item(key = "header") { ThreadHeader(detail.conversation) }
        if (actionError != null) {
            item(key = "error") { ErrorBanner(message = actionError, retryLabel = "Kapat", onRetry = onDismissError) }
        }
        groups.forEach { (day, messages) ->
            item(key = "day-$day") {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text(
                        clock.relativeDayLabel(day),
                        style = KlinaraType.bodyM,
                        color = colors.charcoalMuted,
                        modifier =
                            Modifier
                                .background(colors.surfaceRaised, CircleShape)
                                .padding(horizontal = KlinaraMetrics.md, vertical = KlinaraMetrics.xs),
                    )
                }
            }
            items(messages, key = { it.id }) { MessageBubble(it, clock) }
        }
    }
}

@Composable
private fun ThreadHeader(conversation: Conversation) {
    val colors = KlinaraTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
        Text(ConversationFormat.phone(conversation.phone), style = KlinaraType.bodyM, color = colors.charcoalMuted)
        val remaining = ConversationFormat.windowRemaining(conversation, Instant.now())
        if (remaining != null) {
            Text("Cevap penceresi açık · $remaining kaldı", style = KlinaraType.bodyM, color = colors.sageDeep)
        } else {
            KlinaraBadge("Pencere kapalı", tone = KlinaraBadgeTone.Warning)
        }
    }
}

@Composable
private fun MessageBubble(
    message: ConversationMessage,
    clock: BranchClock,
) {
    val colors = KlinaraTheme.colors
    val shape = RoundedCornerShape(BUBBLE_RADIUS)
    val (background, border) = bubbleColors(message)
    Row(Modifier.fillMaxWidth()) {
        if (message.isOutgoing) Spacer(Modifier.weight(1f))
        Column(
            modifier =
                Modifier
                    .widthIn(max = BUBBLE_MAX_WIDTH)
                    .background(background, shape)
                    .border(BorderStroke(KlinaraMetrics.borderWidth, border), shape)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            message.senderLabel?.let { Text(it, style = KlinaraType.bodyEmphasis, color = colors.sageDeep) }
            Text(
                message.displayBody,
                style = KlinaraType.bodyL,
                color = if (message.body == null) colors.charcoalMuted else colors.charcoal,
            )
            if (message.isFailed) {
                message.errorDetail?.let { Text(it, style = KlinaraType.bodyM, color = colors.danger) }
            }
            Row(
                modifier = Modifier.align(Alignment.End),
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
            ) {
                Text(clock.formatTime(message.createdAt), style = KlinaraType.label, color = colors.charcoalMuted)
                val status = message.status
                if (message.isOutgoing && status != null) {
                    Text(
                        statusMark(status),
                        style = KlinaraType.label,
                        color = if (status == MessageStatus.Failed) colors.danger else colors.charcoalMuted,
                        modifier = Modifier.semantics { contentDescription = status.turkishName },
                    )
                }
            }
        }
        if (!message.isOutgoing) Spacer(Modifier.weight(1f))
    }
}

@Composable
private fun bubbleColors(message: ConversationMessage): Pair<Color, Color> {
    val colors = KlinaraTheme.colors
    return when {
        message.isFailed ->
            colors.danger.copy(alpha = FAILED_FILL_ALPHA) to colors.danger.copy(alpha = FAILED_BORDER_ALPHA)
        message.isOutgoing -> colors.sageSoft to colors.sage.copy(alpha = OUT_BORDER_ALPHA)
        else -> colors.surfaceRaised to colors.border
    }
}

private fun statusMark(status: MessageStatus): String =
    when (status) {
        MessageStatus.Queued, MessageStatus.Sending -> "…"
        MessageStatus.Sent -> "✓"
        MessageStatus.Delivered, MessageStatus.Read -> "✓✓"
        MessageStatus.Failed, MessageStatus.Skipped -> "!"
        MessageStatus.Unknown -> "?"
    }

@Composable
private fun BottomBar(
    conversation: Conversation,
    state: ConversationThreadUiState,
    viewModel: ConversationThreadViewModel,
) {
    val colors = KlinaraTheme.colors
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(colors.surface)
                .imePadding()
                .padding(horizontal = KlinaraMetrics.md, vertical = KlinaraMetrics.sm),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        when {
            conversation.isClosed ->
                Text(
                    "Bu sohbet kapatıldı. Müşteri yeniden yazarsa kendiliğinden açılır.",
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                )
            state.canCompose -> Composer(state.isSending, viewModel)
            else -> {
                Text(
                    "24 saatlik pencere kapalı: serbest mesaj gönderilemez. Onaylı bir şablon gönderebilir " +
                        "ya da müşterinin yeniden yazmasını bekleyebilirsiniz.",
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                )
                KlinaraButton(title = "Şablon gönder", onClick = viewModel::openTemplates)
            }
        }
    }
}

@Composable
private fun Composer(
    isSending: Boolean,
    viewModel: ConversationThreadViewModel,
) {
    val colors = KlinaraTheme.colors
    var draft by rememberSaveable { mutableStateOf("") }
    val canSend = draft.isNotBlank() && !isSending
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
        OutlinedTextField(
            value = draft,
            onValueChange = { draft = it.take(MAX_MESSAGE_LENGTH) },
            placeholder = { Text("Mesaj yazın…", style = KlinaraType.bodyL) },
            textStyle = KlinaraType.bodyL,
            maxLines = COMPOSER_MAX_LINES,
            shape = RoundedCornerShape(COMPOSER_RADIUS),
            colors =
                OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = colors.borderFocus,
                    unfocusedBorderColor = colors.border,
                    focusedContainerColor = colors.surfaceRaised,
                    unfocusedContainerColor = colors.surfaceRaised,
                ),
            modifier = Modifier.weight(1f).semantics { contentDescription = "Mesaj" },
        )
        IconButton(
            onClick = { viewModel.send(draft) { draft = "" } },
            enabled = canSend,
            modifier = Modifier.size(SEND_SIZE).background(if (canSend) colors.sage else colors.disabled, CircleShape),
        ) {
            if (isSending) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), color = colors.surfaceRaised)
            } else {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Gönder", tint = colors.surfaceRaised)
            }
        }
    }
}

private val BUBBLE_RADIUS = 18.dp
private val BUBBLE_MAX_WIDTH = 300.dp
private val COMPOSER_RADIUS = 20.dp
private val SEND_SIZE = 48.dp
private const val COMPOSER_MAX_LINES = 5
private const val MAX_MESSAGE_LENGTH = 4096
private const val FAILED_FILL_ALPHA = 0.08f
private const val FAILED_BORDER_ALPHA = 0.4f
private const val OUT_BORDER_ALPHA = 0.3f
