'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCheck,
  Clock,
  MousePointerClick,
  PanelRight,
  SendHorizontal,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  Conversation,
  ConversationDetail,
  ConversationMessage,
  SendConversationTemplateInput,
} from '@klinara/shared';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import {
  conversationTitle,
  deliveryState,
  EVENT_LABEL,
  formatDayDivider,
  formatMessageTime,
  formatPhone,
  groupByDay,
  INBOUND_TYPE_LABEL,
  windowRemaining,
  type DeliveryState,
} from '@/lib/messages/format';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TemplateDialog } from './template-dialog';

export function ConversationThread({
  detail,
  error,
  sending,
  onSend,
  onSendTemplate,
  onBack,
  onTogglePanel,
  onConversationChange,
  onOpenAppointment,
}: {
  detail: ConversationDetail | null;
  error: string | null;
  sending: boolean;
  onSend: (body: string) => Promise<ConversationMessage | null>;
  onSendTemplate: (input: SendConversationTemplateInput) => Promise<ConversationMessage>;
  onBack: () => void;
  onTogglePanel: () => void;
  onConversationChange: (conversation: Conversation) => void;
  onOpenAppointment: (appointmentId: string) => void;
}): ReactNode {
  const scroller = useRef<HTMLDivElement>(null);
  const messageCount = detail?.messages.length ?? 0;
  const conversationId = detail?.conversation.id ?? null;
  const [busy, setBusy] = useState(false);

  // Yeni mesajda en alta kay — ama kullanıcı yukarıda eski bir mesajı
  // okuyorsa yoklama onu aşağı savurmasın. Sohbet değişince her zaman en alt.
  const lastConversation = useRef<string | null>(null);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null || messageCount === 0) return;
    const switched = lastConversation.current !== conversationId;
    lastConversation.current = conversationId;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 160;
    if (switched || nearBottom) element.scrollTop = element.scrollHeight;
  }, [messageCount, conversationId]);

  if (detail === null) {
    return (
      <div className="flex h-full flex-col gap-3 p-4" aria-busy="true">
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="ml-auto h-16 w-2/3" />
        <Skeleton className="h-12 w-1/2" />
      </div>
    );
  }

  const { conversation } = detail;
  const closed = conversation.status === 'closed';

  async function setStatus(action: 'close' | 'reopen'): Promise<void> {
    setBusy(true);
    try {
      const updated = await api.post<Conversation>(`conversations/${conversation.id}/${action}`);
      onConversationChange(updated);
      if (action === 'close') toast.success(t('messages.closedToast'));
    } catch (caught) {
      const message = toMessage(caught);
      if (message !== null) toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label={t('messages.back')}
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-foreground">
            {conversationTitle(conversation)}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {formatPhone(conversation.phone)}
            {' · '}
            <WindowLabel conversation={conversation} />
          </p>
        </div>
        {/* Dar ekranda yalnız ikon: metin, sohbetin başlığını sıkıştırıp gizliyordu. */}
        {closed ? (
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            aria-label={t('messages.reopen')}
            onClick={() => void setStatus('reopen')}
          >
            <ArchiveRestore aria-hidden="true" />
            <span className="hidden sm:inline">{t('messages.reopen')}</span>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            aria-label={t('messages.close')}
            onClick={() => void setStatus('close')}
          >
            <Archive aria-hidden="true" />
            <span className="hidden sm:inline">{t('messages.close')}</span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="xl:hidden"
          aria-label={t('messages.customerPanel')}
          onClick={onTogglePanel}
        >
          <PanelRight aria-hidden="true" />
        </Button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-muted/40 px-3 py-4 md:px-6">
        {error !== null ? (
          <Alert tone="danger" className="mb-3">
            {error}
          </Alert>
        ) : null}
        <ol className="flex flex-col gap-1" aria-label={conversationTitle(conversation)}>
          {groupByDay(detail.messages).map((group) => (
            <li key={group.day} className="flex flex-col gap-1.5">
              <p className="my-2 self-center rounded-full bg-card px-3 py-0.5 text-xs text-muted-foreground shadow-xs">
                {formatDayDivider(group.messages[0]?.createdAt ?? '')}
              </p>
              {group.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onOpenAppointment={onOpenAppointment}
                />
              ))}
            </li>
          ))}
        </ol>
      </div>

      {closed ? (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
          {t('messages.closed')}
        </p>
      ) : (
        <Composer
          key={conversation.id}
          conversationId={conversation.id}
          disabled={!conversation.windowOpen}
          sending={sending}
          onSend={onSend}
          onSendTemplate={onSendTemplate}
        />
      )}
    </div>
  );
}

function WindowLabel({ conversation }: { conversation: Conversation }): ReactNode {
  const remaining = windowRemaining(conversation);
  if (remaining === null) {
    return <span className="text-warning">{t('messages.window.closedShort')}</span>;
  }
  return <span>{t('messages.window.open', { remaining })}</span>;
}

function MessageBubble({
  message,
  onOpenAppointment,
}: {
  message: ConversationMessage;
  onOpenAppointment: (appointmentId: string) => void;
}): ReactNode {
  const outgoing = message.direction === 'out';
  const eventLabel = message.event === null ? undefined : EVENT_LABEL[message.event];
  const state = outgoing ? deliveryState(message.status) : null;

  let body: ReactNode = message.body;
  if (!outgoing && message.type === 'button') {
    body = (
      <span className="inline-flex items-center gap-1.5 font-medium">
        <MousePointerClick aria-hidden="true" className="size-4 text-primary" />
        <span className="sr-only">{t('messages.buttonReply')}: </span>
        {message.body ?? t('messages.buttonReply')}
      </span>
    );
  } else if (message.body === null || message.body === '') {
    const typeLabel = INBOUND_TYPE_LABEL[message.type];
    body = (
      <span className="italic text-muted-foreground">
        {t(typeLabel ?? 'messages.type.unsupported')}
      </span>
    );
  }

  return (
    <div className={cn('flex', outgoing ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'flex max-w-[85%] flex-col gap-1 rounded-2xl px-3.5 py-2 text-sm shadow-xs md:max-w-[70%]',
          outgoing
            ? 'rounded-br-md border border-primary/20 bg-primary/10 text-foreground'
            : 'rounded-bl-md border border-border bg-card text-foreground',
          state === 'failed' && 'border-destructive/40 bg-destructive-soft',
        )}
      >
        {outgoing ? (
          <p className="text-xs font-semibold text-primary">
            {eventLabel !== undefined
              ? `${t('messages.auto')} · ${t(eventLabel)}`
              : (message.sentByName ?? t('messages.auto'))}
            {eventLabel === undefined && message.type === 'template'
              ? ` · ${t('messages.template.badge')}`
              : null}
          </p>
        ) : null}

        <p className="break-words whitespace-pre-wrap">{body}</p>

        {message.appointmentId !== null ? (
          <button
            type="button"
            onClick={() => onOpenAppointment(message.appointmentId as string)}
            className="inline-flex items-center gap-1 self-start text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            <CalendarDays aria-hidden="true" className="size-3.5" />
            {t('messages.appointmentLink')}
          </button>
        ) : null}

        {state === 'failed' && message.errorDetail !== null ? (
          <p className="text-xs text-destructive">{message.errorDetail}</p>
        ) : null}

        <p className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
          {state === null ? null : <DeliveryIcon state={state} />}
        </p>
      </div>
    </div>
  );
}

const DELIVERY_LABEL: Record<DeliveryState, Parameters<typeof t>[0]> = {
  pending: 'messages.status.pending',
  sent: 'messages.status.sent',
  delivered: 'messages.status.delivered',
  read: 'messages.status.read',
  failed: 'messages.status.failed',
};

function DeliveryIcon({ state }: { state: DeliveryState }): ReactNode {
  const label = t(DELIVERY_LABEL[state]);
  const common = { 'aria-label': label, role: 'img', className: 'size-3.5' } as const;
  switch (state) {
    case 'pending':
      return <Clock {...common} />;
    case 'sent':
      return <Check {...common} />;
    case 'delivered':
      return <CheckCheck {...common} />;
    case 'read':
      return <CheckCheck {...common} className="size-3.5 text-sky-600" />;
    case 'failed':
      return <AlertCircle {...common} className="size-3.5 text-destructive" />;
  }
}

function Composer({
  conversationId,
  disabled,
  sending,
  onSend,
  onSendTemplate,
}: {
  conversationId: string;
  disabled: boolean;
  sending: boolean;
  onSend: (body: string) => Promise<ConversationMessage | null>;
  onSendTemplate: (input: SendConversationTemplateInput) => Promise<ConversationMessage>;
}): ReactNode {
  const [draft, setDraft] = useState('');
  const [templateOpen, setTemplateOpen] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Taslak büyüdükçe alan da büyüsün — beş satıra kadar.
  useEffect(() => {
    const element = textarea.current;
    if (element === null) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }, [draft]);

  async function submit(): Promise<void> {
    const body = draft.trim();
    if (body.length === 0 || sending || disabled) return;
    const sent = await onSend(body);
    if (sent === null) return;
    // Taslak YALNIZ mesaj kaydedildiyse temizlenir; ağ hatasında kullanıcı
    // yazdığını kaybetmesin. Meta hatası ise kayıtlı bir `failed` balonu.
    setDraft('');
    if (sent.status === 'failed') {
      toast.error(t('messages.sendFailed', { reason: sent.errorDetail ?? '' }));
    }
    textarea.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // IME birleştirmesi sürerken Enter bir harfi onaylıyor, mesajı değil.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  if (disabled) {
    return (
      <div className="flex flex-col gap-2 border-t border-border p-3">
        <Alert tone="warn">{t('messages.window.closed')}</Alert>
        <Button className="self-end" onClick={() => setTemplateOpen(true)}>
          <FileText aria-hidden="true" />
          {t('messages.template.open')}
        </Button>
        {templateOpen ? (
          <TemplateDialog
            conversationId={conversationId}
            open
            onClose={() => setTemplateOpen(false)}
            onSend={onSendTemplate}
          />
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="flex items-end gap-2 border-t border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="sr-only" htmlFor="conversation-composer">
        {t('messages.composer.label')}
      </label>
      <textarea
        id="conversation-composer"
        ref={textarea}
        rows={1}
        value={draft}
        maxLength={4096}
        placeholder={t('messages.composer.placeholder')}
        aria-describedby="conversation-composer-hint"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        className="max-h-35 min-h-11 flex-1 resize-none rounded-lg border border-input bg-card px-3 py-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 md:text-sm"
      />
      <p id="conversation-composer-hint" className="sr-only">
        {t('messages.composer.hint')}
      </p>
      <Button
        type="submit"
        size="icon"
        aria-label={t('messages.composer.send')}
        loading={sending}
        disabled={draft.trim().length === 0}
      >
        <SendHorizontal aria-hidden="true" />
      </Button>
    </form>
  );
}
