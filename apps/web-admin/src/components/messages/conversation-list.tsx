'use client';

import type { ReactNode } from 'react';
import { MessageCircle } from 'lucide-react';
import type { Conversation } from '@klinara/shared';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/tr';
import { conversationTitle, formatListTime, initialsOf } from '@/lib/messages/format';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentButton, Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import type { ConversationFilter } from './use-conversations';

const FILTERS: { value: ConversationFilter; label: 'messages.filter.open' | 'messages.filter.unread' | 'messages.filter.closed' }[] = [
  { value: 'open', label: 'messages.filter.open' },
  { value: 'unread', label: 'messages.filter.unread' },
  { value: 'closed', label: 'messages.filter.closed' },
];

export function ConversationList({
  conversations,
  error,
  filter,
  onFilter,
  selectedId,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  conversations: Conversation[] | null;
  error: string | null;
  filter: ConversationFilter;
  onFilter: (filter: ConversationFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}): ReactNode {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Düğmeler dar ekranda eşit paylaşıyor; aksi hâlde "Kapalı" taşıyordu. */}
      <div className="border-b border-border p-3 [&>[role=group]]:flex [&>[role=group]]:w-full [&_button]:flex-1 [&_button]:justify-center [&_button]:px-2">
        <Segmented label={t('messages.filter.label')}>
          {FILTERS.map((option) => (
            <SegmentButton
              key={option.value}
              pressed={filter === option.value}
              onClick={() => onFilter(option.value)}
            >
              {t(option.label)}
            </SegmentButton>
          ))}
        </Segmented>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error !== null && conversations === null ? (
          <Alert tone="danger" className="m-3">
            {error}
          </Alert>
        ) : null}

        {conversations === null && error === null ? (
          <div className="flex flex-col gap-2 p-3" aria-busy="true">
            {[0, 1, 2, 3, 4].map((key) => (
              <Skeleton key={key} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : null}

        {conversations !== null && conversations.length === 0 ? (
          filter === 'open' ? (
            <EmptyState
              icon={MessageCircle}
              title={t('messages.empty.title')}
              message={t('messages.empty.message')}
            />
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {t('messages.emptyFiltered')}
            </p>
          )
        ) : null}

        {conversations !== null && conversations.length > 0 ? (
          <ul className="flex flex-col" aria-label={t('messages.title')}>
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <ConversationRow
                  conversation={conversation}
                  selected={conversation.id === selectedId}
                  onSelect={() => onSelect(conversation.id)}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {hasMore && conversations !== null && conversations.length > 0 ? (
          <div className="p-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              loading={loadingMore}
              onClick={onLoadMore}
            >
              {t('messages.loadMore')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConversationRow({
  conversation,
  selected,
  onSelect,
}: {
  conversation: Conversation;
  selected: boolean;
  onSelect: () => void;
}): ReactNode {
  const title = conversationTitle(conversation);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left transition-colors',
        selected ? 'bg-accent' : 'hover:bg-muted',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
          conversation.customer === null
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary/15 text-primary',
        )}
      >
        {initialsOf(conversation)}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm text-foreground',
              conversation.unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {title}
          </span>
          <span
            className={cn(
              'shrink-0 text-xs',
              conversation.unread ? 'font-semibold text-primary' : 'text-muted-foreground',
            )}
          >
            {formatListTime(conversation.lastMessageAt)}
          </span>
        </span>

        {conversation.customer === null ? (
          <span className="text-xs text-muted-foreground">{t('messages.unknownNumber')}</span>
        ) : null}

        <span className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm',
              conversation.unread ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {conversation.lastMessageDirection === 'out' ? t('messages.you') : ''}
            {conversation.lastMessagePreview ?? ''}
          </span>
          {conversation.unread ? (
            <span className="size-2.5 shrink-0 rounded-full bg-primary" aria-label={t('messages.filter.unread')} />
          ) : null}
        </span>
      </span>
    </button>
  );
}
