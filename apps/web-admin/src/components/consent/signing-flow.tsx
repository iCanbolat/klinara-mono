'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ChevronLeft, FileSignature } from 'lucide-react';
import {
  ERROR_CODES,
  type ConsentRequirements,
  type SignableConsentDocument,
} from '@klinara/shared';
import { t } from '@/i18n/tr';
import { ApiProblemError, api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import {
  canSubmit,
  initialForm,
  isScrolledToEnd,
  nextDocumentForm,
  pendingDocuments,
  signatureInput,
  withRelation,
  type SignerForm,
} from '@/lib/consent/signing-flow';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldCheckbox } from '@/components/ui/field';
import { SegmentButton, Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { SignaturePad, type SignaturePadHandle } from './signature-pad';

type Phase = 'staff' | 'patient' | 'done';

/**
 * İmza modu: personel ekranı → hasta adımları → bitiş.
 *
 * Personel eksik onamları görür ve tableti hastaya verir. Hasta her belgeyi
 * sırayla (önce KVKK) okur, onaylar ve imzalar. Her imza ayrı bir istek ve
 * ayrı, değiştirilemez bir kayıt: yarıda kalan bir akışta atılmış imzalar
 * geçerli kalır, kalanlar eksik görünür.
 */
export function SigningFlow({
  requirementsPath,
  signPath,
  returnHref,
  returnLabel,
  branchId,
}: {
  /** `appointments/:id/consent-requirements` ya da `customers/:id/consent-requirements`. */
  requirementsPath: string;
  signPath: string;
  returnHref: string;
  returnLabel: string;
  branchId: string | null;
}): ReactNode {
  const router = useRouter();
  const [requirements, setRequirements] = useState<ConsentRequirements | null>(null);
  const [queue, setQueue] = useState<SignableConsentDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [phase, setPhase] = useState<Phase>('staff');
  const [form, setForm] = useState<SignerForm>(() => initialForm(''));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const padRef = useRef<SignaturePadHandle | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (): Promise<ConsentRequirements | null> => {
    try {
      const result = await api.get<ConsentRequirements>(requirementsPath);
      setRequirements(result);
      const pending = pendingDocuments(result);
      setQueue(pending);
      return result;
    } catch (caught) {
      setError(toMessage(caught));
      return null;
    }
  }, [requirementsPath]);

  useEffect(() => {
    void (async () => {
      const result = await load();
      if (result !== null) {
        setTotal(pendingDocuments(result).length);
        setForm(initialForm(result.customerName));
      }
    })();
  }, [load]);

  const current = queue[0];

  // Kısa bir metin kaydırma gerektirmiyorsa "sona geldi" baştan doğru.
  useEffect(() => {
    const element = textRef.current;
    if (phase !== 'patient' || element === null) return;
    element.scrollTop = 0;
    if (isScrolledToEnd(element)) setForm((value) => ({ ...value, scrolledToEnd: true }));
  }, [phase, current?.documentId]);

  const onInkChange = useCallback((hasInk: boolean) => {
    setForm((value) => ({ ...value, hasInk }));
  }, []);

  async function submit(): Promise<void> {
    if (current === undefined || requirements === null) return;
    const png = padRef.current?.toPng() ?? null;
    if (png === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post(signPath, signatureInput(current, form, png), {
        ...(branchId === null ? {} : { branchId }),
      });
      const rest = queue.slice(1);
      setQueue(rest);
      padRef.current?.clear();
      setForm((value) => nextDocumentForm(value));
      if (rest.length === 0) setPhase('done');
    } catch (caught) {
      if (caught instanceof ApiProblemError && caught.code === ERROR_CODES.CONSENT_TEXT_CHANGED) {
        // Metin arada yeniden yayınlandı: güncel metni yükle, hasta baştan okusun.
        const fresh = await load();
        padRef.current?.clear();
        setForm((value) => nextDocumentForm(value));
        setNotice(t('consent.sign.textChanged'));
        if (fresh !== null && pendingDocuments(fresh).length === 0) setPhase('done');
      } else {
        setError(toMessage(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  if (requirements === null) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6" aria-busy={error === null}>
        {error !== null ? (
          <Alert tone="danger">
            <span role="alert">{error}</span>
          </Alert>
        ) : (
          <>
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-64 rounded-xl" />
          </>
        )}
        <Button variant="ghost" className="self-start" onClick={() => router.push(returnHref)}>
          <ChevronLeft aria-hidden="true" />
          {returnLabel}
        </Button>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 p-6 text-center">
        <CheckCircle2 aria-hidden="true" className="size-16 text-success" />
        <div className="flex flex-col gap-2">
          <h1 className="text-display-m text-foreground">{t('consent.sign.doneTitle')}</h1>
          <p className="text-muted-foreground">{t('consent.sign.doneBody')}</p>
        </div>
        <Button size="lg" onClick={() => router.push(returnHref)}>
          {returnLabel}
        </Button>
      </div>
    );
  }

  if (phase === 'staff') {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        <Button variant="ghost" className="self-start" onClick={() => router.push(returnHref)}>
          <ChevronLeft aria-hidden="true" />
          {returnLabel}
        </Button>
        <div className="flex flex-col gap-1">
          <h1 className="text-display-m text-foreground">{t('consent.sign.pageTitle')}</h1>
          <p className="text-muted-foreground">
            {t('consent.sign.staffIntro', { name: requirements.customerName })}
          </p>
        </div>
        {error !== null ? (
          <Alert tone="danger">
            <span role="alert">{error}</span>
          </Alert>
        ) : null}
        <Card className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {requirements.items.map((item) => (
              <li
                key={`${item.kind}-${item.templateId ?? 'kvkk'}`}
                className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0 last:pb-0"
              >
                <span className="flex items-center gap-2">
                  <FileSignature aria-hidden="true" className="size-4 text-muted-foreground" />
                  {item.title}
                </span>
                <Badge variant={item.satisfied ? 'secondary' : 'default'}>
                  {item.satisfied
                    ? item.signatureId === null
                      ? t('consent.required.acceptedOnline')
                      : t('consent.required.signed')
                    : t('consent.required.pending')}
                </Badge>
              </li>
            ))}
          </ul>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {requirements.items.length === 0
                ? t('consent.required.none')
                : t('consent.sign.nothingMissing')}
            </p>
          ) : null}
        </Card>
        {queue.length > 0 ? (
          <Button size="lg" className="self-start" onClick={() => setPhase('patient')}>
            {t('consent.sign.handOver')}
          </Button>
        ) : null}
      </div>
    );
  }

  if (current === undefined) return null;
  const step = total - queue.length + 1;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">
          {t('consent.sign.step', { current: Math.min(step, total), total })}
        </span>
        <h1 className="text-display-m text-foreground">{current.title}</h1>
        <span className="text-xs text-muted-foreground">
          {t('consent.sign.version', { version: current.version })}
        </span>
      </header>

      {notice !== null ? <Alert tone="warn">{notice}</Alert> : null}

      <div
        ref={textRef}
        tabIndex={0}
        aria-label={current.title}
        onScroll={(event) => {
          if (form.scrolledToEnd) return;
          if (isScrolledToEnd(event.currentTarget)) {
            setForm((value) => ({ ...value, scrolledToEnd: true }));
          }
        }}
        className="max-h-[45dvh] overflow-y-auto whitespace-pre-wrap rounded-xl border bg-card p-5 text-base leading-relaxed"
      >
        {current.body}
      </div>
      {!form.scrolledToEnd ? (
        <p className="text-sm text-muted-foreground">{t('consent.sign.scrollHint')}</p>
      ) : null}

      <FieldCheckbox
        label={t('consent.sign.acknowledge')}
        checked={form.acknowledged}
        disabled={!form.scrolledToEnd || busy}
        onCheckedChange={(checked) => setForm((value) => ({ ...value, acknowledged: checked }))}
      />

      <div className="flex flex-col items-start gap-3">
        <Segmented label={t('consent.sign.relation')}>
          <SegmentButton
            pressed={form.relation === 'self'}
            onClick={() =>
              setForm((value) => withRelation(value, 'self', requirements.customerName))
            }
          >
            {t('consent.sign.relationSelf')}
          </SegmentButton>
          <SegmentButton
            pressed={form.relation === 'guardian'}
            onClick={() =>
              setForm((value) => withRelation(value, 'guardian', requirements.customerName))
            }
          >
            {t('consent.sign.relationGuardian')}
          </SegmentButton>
        </Segmented>
        <div className="grid w-full gap-3 sm:grid-cols-2">
          <Field
            label={t('consent.sign.signerName')}
            value={form.signerName}
            autoComplete="off"
            disabled={busy}
            onChange={(event) => {
              const signerName = event.target.value;
              setForm((value) => ({ ...value, signerName }));
            }}
          />
          {form.relation === 'guardian' ? (
            <Field
              label={t('consent.sign.guardianOf')}
              value={form.guardianOfName}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => {
                const guardianOfName = event.target.value;
                setForm((value) => ({ ...value, guardianOfName }));
              }}
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <span className="text-label">{t('consent.sign.signature')}</span>
            <p className="text-xs text-muted-foreground">{t('consent.sign.signatureHint')}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!form.hasInk || busy}
            onClick={() => padRef.current?.clear()}
          >
            {t('consent.sign.clear')}
          </Button>
        </div>
        <SignaturePad ref={padRef} label={t('consent.sign.signature')} onInkChange={onInkChange} />
      </div>

      {error !== null ? (
        <Alert tone="danger">
          <span role="alert">{error}</span>
        </Alert>
      ) : null}

      <Button
        size="lg"
        loading={busy}
        disabled={!canSubmit(form) || busy}
        onClick={() => void submit()}
      >
        {t('consent.sign.submit')}
      </Button>
    </div>
  );
}
