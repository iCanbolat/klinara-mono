'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation, ConversationPage } from '@klinara/shared';
import { api } from '@/lib/api/client';
import { onMessageEvent } from '@/lib/messages/message-events';
import { toMessage } from '@/lib/reports/errors';

export type ConversationFilter = 'open' | 'unread' | 'closed';

/**
 * Liste yoklaması — güvenlik ağı. Gelen mesaj soket üzerinden anında
 * tazeletiyor (`message-events`); yoklama soketin kopuk olduğu anları ve
 * bildirim üretmeyen değişiklikleri kapatıyor. Sekme gizliyken yoklama
 * DURUYOR — açık unutulmuş bir sekme gün boyu istek atmasın.
 */
const LIST_POLL_MS = 15_000;
const PAGE_SIZE = 30;

function queryOf(filter: ConversationFilter, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  params.set('status', filter === 'closed' ? 'closed' : 'open');
  if (filter === 'unread') params.set('unreadOnly', 'true');
  if (cursor !== null) params.set('cursor', cursor);
  return `conversations?${params.toString()}`;
}

export interface ConversationsState {
  conversations: Conversation[] | null;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  reload: () => void;
  /** Tek satırı yerinde günceller — okundu, kapatıldı, müşteri bağlandı. */
  replace: (conversation: Conversation) => void;
}

export function useConversations(filter: ConversationFilter): ConversationsState {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Süzgeç değişince liste render sırasında sıfırlanıyor: eski süzgecin
  // satırları yeni süzgecin iskeletinin yerine bir an bile görünmesin.
  const [listKey, setListKey] = useState(filter);
  if (listKey !== filter) {
    setListKey(filter);
    setConversations(null);
    setNextCursor(null);
  }

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const page = await api.get<ConversationPage>(queryOf(filter, null), {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        // Yoklama İLK sayfayı tazeliyor; "daha eski"yle yüklenmiş satırlar
        // kaybolmasın diye yeni sayfada olmayanlar sona ekleniyor.
        setConversations((current) => {
          if (current === null) return page.data;
          const fresh = new Set(page.data.map((row) => row.id));
          return [...page.data, ...current.filter((row) => !fresh.has(row.id))];
        });
        setNextCursor((current) =>
          current === null || !page.pageInfo.hasMore ? page.pageInfo.nextCursor : current,
        );
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [filter, nonce]);

  // Görünürken yoklama; sekmeye dönüldüğünde hemen bir kez.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) reload();
    }, LIST_POLL_MS);
    const onVisible = (): void => {
      if (!document.hidden) reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  // Gelen mesaj bildirimi → liste hemen tazelenir.
  useEffect(() => onMessageEvent(reload), [reload]);

  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(() => {
    if (nextCursor === null || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    void (async () => {
      try {
        const page = await api.get<ConversationPage>(queryOf(filter, nextCursor));
        setConversations((current) => {
          const known = new Set((current ?? []).map((row) => row.id));
          return [...(current ?? []), ...page.data.filter((row) => !known.has(row.id))];
        });
        setNextCursor(page.pageInfo.hasMore ? page.pageInfo.nextCursor : null);
      } catch (caught) {
        setError(toMessage(caught));
      } finally {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    })();
  }, [filter, nextCursor]);

  const replace = useCallback((conversation: Conversation) => {
    setConversations((current) =>
      current === null
        ? current
        : current.map((row) => (row.id === conversation.id ? conversation : row)),
    );
  }, []);

  return {
    conversations,
    error,
    hasMore: nextCursor !== null,
    loadingMore,
    loadMore,
    reload,
    replace,
  };
}
