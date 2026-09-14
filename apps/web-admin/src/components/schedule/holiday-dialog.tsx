'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { Holiday } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import {
  draftFromHoliday,
  emptyHolidayDraft,
  toHolidayCreateBody,
  toHolidayPatchBody,
  validateHoliday,
  type HolidayDraft,
} from '@/lib/schedule/holidays';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldSwitch } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { SegmentButton, Segmented } from '@/components/ui/segmented';

/**
 * Tatil ekle / düzenle.
 *
 * ⚠️ `PATCH` tarihi ve kapsamı DEĞİŞTİRMİYOR ("başka bir gün, başka bir
 * kayıttır"). Düzenlemede o iki alan kilitli ve sebebi yazılı; kullanıcıya
 * değiştirilebilir gibi görünen ama kaydedilmeyen bir alan göstermiyoruz.
 *
 * "Tüm şubeler" seçeneği yalnız kiracı kapsamlı rollere sunuluyor: şube
 * yöneticisi `schedule:write` taşısa da kapsamı kendi şubesi ve kiracı geneli
 * kayıt yazmaya çalışınca `403 BRANCH_FORBIDDEN` alırdı.
 */
export function HolidayDialog({
  open,
  holiday,
  branchId,
  canWriteTenant,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** `null` = yeni kayıt. */
  holiday: Holiday | null;
  branchId: string;
  canWriteTenant: boolean;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {open ? (
          <HolidayForm
            key={holiday?.id ?? 'new'}
            holiday={holiday}
            branchId={branchId}
            canWriteTenant={canWriteTenant}
            onClose={onClose}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function HolidayForm({
  holiday,
  branchId,
  canWriteTenant,
  onClose,
  onSaved,
}: {
  holiday: Holiday | null;
  branchId: string;
  canWriteTenant: boolean;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const editing = holiday !== null;
  const [draft, setDraft] = useState<HolidayDraft>(() =>
    holiday === null ? emptyHolidayDraft() : draftFromHoliday(holiday),
  );
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = validateHoliday(draft);
  const shown = submitted ? errors : {};
  const patch = (next: Partial<HolidayDraft>): void => setDraft((current) => ({ ...current, ...next }));

  async function submit(): Promise<void> {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setError(null);
    try {
      if (holiday === null) {
        await api.post('holidays', toHolidayCreateBody(draft, branchId), { branchId });
      } else {
        await api.patch(`holidays/${holiday.id}`, toHolidayPatchBody(draft), { branchId });
      }
      toast.success(t('schedule.holidaySaved'));
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
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? t('schedule.holidayEdit') : t('schedule.holidayNew')}</DialogTitle>
        <DialogDescription>
          {editing ? t('schedule.holidayLocked') : t('schedule.holidaysEmptyHint')}
        </DialogDescription>
      </DialogHeader>

      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
        <Field
          label={t('schedule.holidayDate')}
          type="date"
          value={draft.holidayDate}
          disabled={editing}
          error={shown.holidayDate}
          onChange={(event) => patch({ holidayDate: event.target.value })}
        />
        <Field
          label={t('schedule.holidayName')}
          value={draft.name}
          maxLength={200}
          error={shown.name}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </div>

      {canWriteTenant || editing ? (
        <div className="flex flex-col gap-2">
          <Label>{t('schedule.holidayScope')}</Label>
          <Segmented label={t('schedule.holidayScope')}>
            <SegmentButton
              pressed={draft.scope === 'branch'}
              onClick={() => !editing && patch({ scope: 'branch' })}
            >
              {t('schedule.holidayScopeBranch')}
            </SegmentButton>
            <SegmentButton
              pressed={draft.scope === 'tenant'}
              onClick={() => !editing && patch({ scope: 'tenant' })}
            >
              {t('schedule.holidayScopeTenant')}
            </SegmentButton>
          </Segmented>
          {draft.scope === 'tenant' ? (
            <p className="text-xs text-muted-foreground">{t('schedule.holidayOverrideHint')}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <FieldSwitch
          label={t('schedule.holidayClosedAllDay')}
          checked={draft.isClosed}
          onCheckedChange={(isClosed) => patch({ isClosed })}
          className="py-0"
        />
        {draft.isClosed ? null : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t('schedule.open')}
              type="time"
              step={300}
              value={draft.openTime}
              error={shown.openTime}
              onChange={(event) => patch({ openTime: event.target.value })}
            />
            <Field
              label={t('schedule.close')}
              type="time"
              step={300}
              value={draft.closeTime}
              error={shown.closeTime}
              onChange={(event) => patch({ closeTime: event.target.value })}
            />
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={saving}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
