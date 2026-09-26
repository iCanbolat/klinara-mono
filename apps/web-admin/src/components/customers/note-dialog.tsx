'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { CustomerNoteKind } from '@klinara/shared';
import { t, type MessageKey } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldSelect, FieldTextarea } from '@/components/ui/field';

export const NOTE_KIND_LABEL: Record<CustomerNoteKind, MessageKey> = {
  general: 'customers.notes.general',
  treatment: 'customers.notes.treatment',
  internal: 'customers.notes.internal',
};

/**
 * Yeni not.
 *
 * `kinds` ÇAĞIRANDAN geliyor ve yalnız kullanıcının YAZABİLDİĞİ türleri
 * içeriyor (`canWriteNote`); dialog izin kararı vermiyor.
 */
export function NoteDialog({
  open,
  customerId,
  kinds,
  onClose,
  onSaved,
}: {
  open: boolean;
  customerId: string;
  kinds: CustomerNoteKind[];
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Her açılışta taze form: kapatılan bir taslak bir sonraki notta
            önceden dolu görünmesin. */}
        {open ? (
          <NoteForm customerId={customerId} kinds={kinds} onClose={onClose} onSaved={onSaved} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NoteForm({
  customerId,
  kinds,
  onClose,
  onSaved,
}: {
  customerId: string;
  kinds: CustomerNoteKind[];
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const [kind, setKind] = useState<CustomerNoteKind>(kinds[0] ?? 'general');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (body.trim() === '') return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`customers/${customerId}/notes`, { body: body.trim(), kind });
      toast.success(t('customers.notes.saved'));
      onSaved();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('customers.notes.new')}</DialogTitle>
        <DialogDescription>{t('customers.notes.newHint')}</DialogDescription>
      </DialogHeader>

      <DialogBody className="flex flex-col gap-5">
        {error !== null ? (
          <Alert tone="danger">
            <span role="alert">{error}</span>
          </Alert>
        ) : null}

        <FieldSelect
          label={t('customers.notes.kind')}
          value={kind}
          disabled={saving}
          onChange={(event) => setKind(event.target.value as CustomerNoteKind)}
        >
          {kinds.map((value) => (
            <option key={value} value={value}>
              {t(NOTE_KIND_LABEL[value])}
            </option>
          ))}
        </FieldSelect>

        <FieldTextarea
          label={t('customers.notes.body')}
          rows={5}
          value={body}
          disabled={saving}
          placeholder={t('customers.notes.placeholder')}
          autoFocus
          onChange={(event) => setBody(event.target.value)}
        />
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={saving} disabled={saving || body.trim() === ''}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
