'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Conversation,
  ConversationDetail,
  ConversationMessage,
  SendConversationTemplateInput,
} from '@klinara/shared';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';

/** Açık sohbette yoklama daha sık: müşteri o anda yazıyor olabilir. */
const THREAD_POLL_MS = 5_000;

export interface ConversationState {
  detail: ConversationDetail | null;
  error: string | null;
  sending: boolean;
  /** Sunucunun döndürdüğü mesaj; gönderim hatası da `status: failed` olarak döner. */
  send: (body: string) => Promise<ConversationMessage | null>;
  /** Pencere kapalıyken onaylı şablon; hata fırlatır ki diyalog gösterebilsin. */
  sendTemplate: (input: SendConversationTemplateInput) => Promise<ConversationMessage>;
  reload: () => void;
  /** Kapatma/açma/müşteri bağlama sonrası sohbet satırını günceller. */
  setConversation: (conversation: Conversation) => void;
}

export function useConversation(
  id: string | null,
  onConversationChange: (conversation: Conversation) => void,
): ConversationState {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [nonce, setNonce] = useState(0);
  const onChange = useRef(onConversationChange);
  useEffect(() => {
    onChange.current = onConversationChange;
  }, [onConversationChange]);

  // Sohbet değişince eski akış bir an bile görünmesin.
  const [detailKey, setDetailKey] = useState(id);
  if (detailKey !== id) {
    setDetailKey(id);
    setDetail(null);
    setError(null);
  }

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (id === null) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await api.get<ConversationDetail>(`conversations/${id}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setError(null);

        // Açık sohbet OKUNMUŞ sayılır. İşaret sunucuya yazılıyor ve listedeki
        // satır da yerinde güncelleniyor ki rozet hemen düşsün.
        if (result.conversation.unread) {
          const read = { ...result.conversation, unread: false };
          setDetail({ ...result, conversation: read });
          onChange.current(read);
          await api.post(`conversations/${id}/read`).catch(() => undefined);
          return;
        }
        setDetail(result);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [id, nonce]);

  useEffect(() => {
    if (id === null) return;
    const timer = setInterval(() => {
      if (!document.hidden) reload();
    }, THREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [id, reload]);

  const append = useCallback((message: ConversationMessage) => {
    setDetail((current) =>
      current === null
        ? current
        : {
            conversation: {
              ...current.conversation,
              lastMessageAt: message.createdAt,
              lastMessagePreview: message.body,
              lastMessageDirection: 'out',
              unread: false,
            },
            messages: [...current.messages, message],
          },
    );
  }, []);

  const send = useCallback(
    async (body: string): Promise<ConversationMessage | null> => {
      if (id === null) return null;
      setSending(true);
      setError(null);
      try {
        const message = await api.post<ConversationMessage>(`conversations/${id}/messages`, {
          body,
        });
        append(message);
        return message;
      } catch (caught) {
        setError(toMessage(caught));
        return null;
      } finally {
        setSending(false);
      }
    },
    [id, append],
  );

  const sendTemplate = useCallback(
    async (input: SendConversationTemplateInput): Promise<ConversationMessage> => {
      if (id === null) throw new Error('Sohbet seçili değil');
      const message = await api.post<ConversationMessage>(`conversations/${id}/template`, input);
      append(message);
      return message;
    },
    [id, append],
  );

  const setConversation = useCallback((conversation: Conversation) => {
    setDetail((current) => (current === null ? current : { ...current, conversation }));
    onChange.current(conversation);
  }, []);

  return { detail, error, sending, send, sendTemplate, reload, setConversation };
}
