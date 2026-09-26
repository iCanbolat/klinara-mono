'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MessagesSquare } from 'lucide-react';
import type { Conversation, Service, StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { useBranch } from '@/components/session/branch-provider';
import { AppointmentSheet } from '@/components/calendar/appointment-sheet';
import { CreateAppointmentDialog } from '@/components/calendar/appointment-form/create-dialog';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ConversationList } from './conversation-list';
import { ConversationThread } from './conversation-thread';
import { CustomerPanel } from './customer-panel';
import { useConversation } from './use-conversation';
import { useConversations, type ConversationFilter } from './use-conversations';

/**
 * Resepsiyonun WhatsApp sohbetleri.
 *
 * Üç sütun: liste · akış · müşteri ve randevular. Dar ekranda tek sütun —
 * seçili sohbet varsa akış, yoksa liste; müşteri paneli yandan açılan bir
 * sayfa. Seçili sohbet `?c=` parametresinde duruyor: bağlantı paylaşılabilir
 * ve tarayıcının geri tuşu listeye döndürüyor.
 *
 * Randevu işlemleri (erteleme, iptal, durum, not) takvimin kendi
 * `AppointmentSheet`i ile yapılıyor — aynı kurallar, aynı sürüm kontrolü;
 * ikinci bir randevu formu yazmak iki yerde ayrışan iki kural demekti.
 */
export function MessagesPage(): ReactNode {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get('c');

  const [filter, setFilter] = useState<ConversationFilter>('open');
  const list = useConversations(filter);
  const thread = useConversation(selectedId, list.replace);

  const [panelOpen, setPanelOpen] = useState(false);
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [appointmentsNonce, setAppointmentsNonce] = useState(0);

  const select = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id === null) next.delete('c');
      else next.set('c', id);
      const query = next.toString();
      // `push`: geri tuşu dar ekranda akıştan listeye dönsün.
      router.push(query === '' ? pathname : `${pathname}?${query}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const conversation = thread.detail?.conversation ?? null;
  const refreshAppointments = useCallback(() => {
    setAppointmentsNonce((value) => value + 1);
    // Randevu değişikliği (iptal, onay) müşteriye otomatik mesaj üretebilir.
    thread.reload();
  }, [thread]);

  const panel =
    conversation === null ? null : (
      <CustomerPanel
        conversation={conversation}
        refreshKey={appointmentsNonce}
        onConversationChange={thread.setConversation}
        onOpenAppointment={setAppointmentId}
        onCreateAppointment={() => setCreating(true)}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-m text-foreground">{t('messages.title')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t('messages.description')}</p>
      </div>

      {list.error !== null && list.conversations !== null ? (
        <Alert tone="danger">{list.error}</Alert>
      ) : null}

      <div className="flex h-[calc(100dvh-15rem)] min-h-[520px] overflow-hidden rounded-xl border border-border bg-card">
        <aside
          className={cn(
            'w-full shrink-0 border-border md:w-72 md:border-r',
            selectedId !== null && 'hidden md:block',
          )}
        >
          <ConversationList
            conversations={list.conversations}
            error={list.error}
            filter={filter}
            onFilter={setFilter}
            selectedId={selectedId}
            onSelect={select}
            hasMore={list.hasMore}
            loadingMore={list.loadingMore}
            onLoadMore={list.loadMore}
          />
        </aside>

        {/*
          `w-0`: `min-w-0` tek başına YETMİYOR. Akıştaki tek satırlık (`truncate`)
          başlıklar min-content katkısını tam metin genişliğine çıkarıyor ve bu,
          panelin kabuğunu yatayda taşırıyordu. Genişliği 0'dan başlatmak
          katkıyı sıfırlıyor; `flex-1` alanı yine dolduruyor.
        */}
        <section
          className={cn('w-0 min-w-0 flex-1', selectedId === null && 'hidden md:block')}
          aria-label={t('messages.title')}
        >
          {selectedId === null ? (
            <EmptyState
              icon={MessagesSquare}
              title={t('messages.select.title')}
              message={t('messages.select.message')}
              className="h-full justify-center"
            />
          ) : (
            <ConversationThread
              detail={thread.detail}
              error={thread.error}
              sending={thread.sending}
              onSend={thread.send}
              onSendTemplate={thread.sendTemplate}
              onBack={() => select(null)}
              onTogglePanel={() => setPanelOpen(true)}
              onConversationChange={thread.setConversation}
              onOpenAppointment={setAppointmentId}
            />
          )}
        </section>

        {panel !== null ? (
          <aside
            className="hidden w-72 shrink-0 overflow-y-auto border-l border-border xl:block"
            aria-label={t('messages.customerPanel')}
          >
            {panel}
          </aside>
        ) : null}
      </div>

      {/* Dar ekranda müşteri paneli yandan açılır. */}
      <Sheet open={panelOpen && panel !== null} onOpenChange={setPanelOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('messages.customerPanel')}</SheetTitle>
            <SheetDescription className="sr-only">{t('messages.customerPanel')}</SheetDescription>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>

      <AppointmentActions
        conversation={conversation}
        appointmentId={appointmentId}
        creating={creating}
        onCloseAppointment={() => setAppointmentId(null)}
        onCloseCreate={() => setCreating(false)}
        onChanged={refreshAppointments}
      />
    </div>
  );
}

/**
 * Takvimin randevu sheet'i ve oluşturma diyaloğu.
 *
 * Katalog ve personel yalnız diyalog İLK açıldığında okunuyor: resepsiyonun
 * çoğu sohbeti randevu oluşturmadan bitiyor ve her sayfa açılışında iki
 * listeyi çekmenin anlamı yok.
 */
function AppointmentActions({
  conversation,
  appointmentId,
  creating,
  onCloseAppointment,
  onCloseCreate,
  onChanged,
}: {
  conversation: Conversation | null;
  appointmentId: string | null;
  creating: boolean;
  onCloseAppointment: () => void;
  onCloseCreate: () => void;
  onChanged: () => void;
}): ReactNode {
  const { branchId, branches } = useBranch();
  const [catalog, setCatalog] = useState<{ services: Service[]; staff: StaffProfile[] } | null>(
    null,
  );

  // "Tüm şubeler" seçiliyse ilk şube: randevu her zaman BİR şubede açılır.
  const branch = useMemo(
    () => branches.find((candidate) => candidate.id === branchId) ?? branches[0] ?? null,
    [branches, branchId],
  );

  useEffect(() => {
    if (!creating || catalog !== null) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const [services, staff] = await Promise.all([
          api.get<{ data: Service[] }>('services', { signal: controller.signal }),
          api.get<{ data: StaffProfile[] }>('staff', { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setCatalog({ services: services.data, staff: staff.data });
      } catch {
        // Diyalog boş listeyle açılır ve hizmet seçilemez; kullanıcı kapatıp
        // yeniden dener. Ayrı bir hata satırı diyaloğun kendi hatasıyla çakışırdı.
        if (!controller.signal.aborted) setCatalog({ services: [], staff: [] });
      }
    })();
    return () => controller.abort();
  }, [creating, catalog]);

  const initialCustomer = useMemo(
    () =>
      conversation?.customer == null
        ? null
        : {
            id: conversation.customer.id,
            label: conversation.customer.fullName,
            hint: conversation.phone,
          },
    [conversation],
  );

  return (
    <>
      <AppointmentSheet
        appointmentId={appointmentId}
        timezone={branch?.timezone ?? 'Europe/Istanbul'}
        services={catalog?.services ?? []}
        onClose={onCloseAppointment}
        onChanged={onChanged}
      />
      {branch !== null ? (
        <CreateAppointmentDialog
          open={creating && catalog !== null}
          branchId={branch.id}
          timezone={branch.timezone}
          services={catalog?.services ?? []}
          staff={catalog?.staff ?? []}
          initialCustomer={initialCustomer}
          onClose={onCloseCreate}
          onCreated={onChanged}
        />
      ) : null}
    </>
  );
}
