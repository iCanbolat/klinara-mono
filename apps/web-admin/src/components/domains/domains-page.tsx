'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PERMISSIONS, type Domain } from '@klinara/shared';
import { ApiProblemError, api } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { anySettling, canMakePrimary, canRemove } from '@/lib/domains/status';
import { nextPollDelay } from '@/lib/domains/poll';
import { diagnose } from '@/lib/domains/diagnose';
import { can } from '@/lib/permissions';
import { useSession } from '@/components/session/session-provider';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { DnsRecord } from './dns-record';
import { StatusBadge } from './status-badge';

/** Batch 11.6 — alan adı yönetimi. */
export function DomainsPage(): ReactNode {
  const { permissions } = useSession();
  const canManage = can(permissions, PERMISSIONS.BOOKING_PAGE_MANAGE);

  const [domains, setDomains] = useState<Domain[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [pollStopped, setPollStopped] = useState(false);

  const load = useCallback(async () => {
    try {
      setDomains(await api.get<Domain[]>('booking-page/domains'));
    } catch (caught) {
      setError(toMessage(caught));
    }
  }, []);

  useEffect(() => {
    // Efekt gövdesinde `void load()` çağırmak, lint için setState'i SENKRON
    // çağırmak sayılıyor (`react-hooks/set-state-in-effect`). Async sarmalayıcı
    // durum güncellemesini promise geri çağrısına taşıyor.
    void (async () => {
      await load();
    })();
  }, [load]);

  /**
   * Doğrulama yoklaması.
   *
   * ⚠️ Sekme gizliyken DURUYOR ve toplam süresi sınırlı. Süresiz yoklama,
   * sekmesini açık unutan bir kullanıcının tarayıcısından saatlerce istek
   * göndermek demekti; takvimin kendisi saf ve test edilmiş (`poll.ts`).
   */
  const startedAt = useRef<number | null>(null);
  const attempt = useRef(0);

  useEffect(() => {
    if (domains === null || !anySettling(domains) || pollStopped) return;
    startedAt.current ??= Date.now();

    const delay = nextPollDelay(attempt.current, Date.now() - startedAt.current);
    if (delay === null) {
      setPollStopped(true);
      return;
    }

    const timer = setTimeout(() => {
      if (document.hidden) return;
      attempt.current += 1;
      void load();
    }, delay);
    return () => clearTimeout(timer);
  }, [domains, load, pollStopped]);

  /**
   * `useCallback` burada bir bellekleme optimizasyonu DEĞİL: `Date.now()`
   * saf olmayan bir çağrı ve render kapsamında tanımlanmış düz bir fonksiyonda
   * lint tarafından reddediliyor. `useCallback` gövdeyi bir olay işleyicisi
   * olarak işaretliyor — ki gerçekte de o.
   */
  const act = useCallback(
    async (id: string, action: 'verify' | 'primary'): Promise<void> => {
      setBusy(id);
      setError(null);
      try {
        await api.post(`booking-page/domains/${id}/${action}`);
        // Elle tetiklenen doğrulama yoklamayı yeniden başlatıyor: kullanıcı
        // "Şimdi doğrula"ya bastıysa artık aktif olarak bekliyor demektir.
        startedAt.current = Date.now();
        attempt.current = 0;
        setPollStopped(false);
        await load();
      } catch (caught) {
        setError(toMessage(caught));
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  async function remove(id: string): Promise<void> {
    setBusy(id);
    try {
      await api.delete(`booking-page/domains/${id}`);
      await load();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function add(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy('new');
    setError(null);
    try {
      await api.post('booking-page/domains', { host });
      setHost('');
      await load();
    } catch (caught) {
      // `HOST_TAKEN` burada BAŞKA HİÇBİR BİLGİ vermiyor — `problem.ts` sunucunun
      // `detail`ini kasıtla yok sayıyor.
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">{t('domains.title')}</h1>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {domains === null ? (
        <p className="text-sm text-ink-soft">{t('common.loading')}</p>
      ) : (
        domains.map((domain) => (
          <Card key={domain.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{domain.host}</p>
                {domain.isPrimary ? (
                  <p className="text-xs text-ink-soft">{t('page.canonicalUrl')}</p>
                ) : null}
              </div>
              <StatusBadge status={domain.verificationStatus} />
            </div>

            {domain.kind === 'platform_subdomain' ? (
              <p className="mt-2 text-xs text-ink-soft">{t('domains.platformNote')}</p>
            ) : null}

            {domain.verificationStatus === 'failed' ? (
              <Alert tone="danger" className="mt-3">
                <p>{t(diagnose(domain.failureReason))}</p>
                {domain.failureReason !== null ? (
                  <p className="mt-1 text-xs opacity-80">{domain.failureReason}</p>
                ) : null}
              </Alert>
            ) : null}

            {domain.dnsInstructions !== null ? (
              <div className="mt-3">
                <p className="text-sm font-medium text-ink">{t('domains.dnsTitle')}</p>
                <p className="mb-2 text-xs text-ink-soft">{t('domains.dnsDescription')}</p>
                <div className="flex flex-col gap-2">
                  <DnsRecord
                    type="TXT"
                    name={domain.dnsInstructions.txtName}
                    value={domain.dnsInstructions.txtValue}
                  />
                  <DnsRecord
                    type="CNAME"
                    name={domain.dnsInstructions.cnameName}
                    value={domain.dnsInstructions.cnameValue}
                  />
                </div>
              </div>
            ) : null}

            {canManage ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {domain.dnsInstructions !== null ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy === domain.id}
                    onClick={() => void act(domain.id, 'verify')}
                  >
                    {t('domains.verifyNow')}
                  </Button>
                ) : null}
                {canMakePrimary(domain) ? (
                  <Button size="sm" variant="secondary" onClick={() => void act(domain.id, 'primary')}>
                    {t('domains.makePrimary')}
                  </Button>
                ) : null}
                {canRemove(domain) ? (
                  <Button size="sm" variant="ghost" onClick={() => void remove(domain.id)}>
                    {t('domains.remove')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </Card>
        ))
      )}

      {pollStopped ? <Alert tone="info">{t('domains.pollStopped')}</Alert> : null}

      {canManage ? (
        <Card>
          <form onSubmit={(event) => void add(event)} className="flex flex-col gap-3">
            <Field
              label={t('domains.host')}
              placeholder={t('domains.hostPlaceholder')}
              value={host}
              onChange={(event) => setHost(event.target.value)}
              maxLength={253}
              required
            />
            <Button type="submit" loading={busy === 'new'} className="self-start">
              {t('domains.add')}
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}

function toMessage(caught: unknown): string {
  return caught instanceof ApiProblemError
    ? describeProblem(caught.problem, caught.retryAfterSeconds).message
    : networkError().message;
}
