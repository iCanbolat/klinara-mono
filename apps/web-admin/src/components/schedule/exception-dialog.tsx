'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { todayKey } from '@/lib/calendar/date';
import { toMessage } from '@/lib/reports/errors';
import {
  emptyExceptionDraft,
  toExceptionBody,
  validateException,
  type ExceptionDraft,
} from '@/lib/schedule/exceptions';
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
import { Field, FieldSelect, FieldSwitch } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { SegmentButton, Segmented } from '@/components/ui/segmented';
import { WeekdayPicker } from './weekday-picker';

/**
 * Yeni izin formu — tek seferlik ya da haftalık tekrar.
 *
 * Hatalar alan ALTINDA ve yalnız bir kez "kaydet"e basıldıktan sonra
 * gösteriliyor: boş formu açan kullanıcıyı kırmızı satırlarla karşılamak,
 * henüz yapmadığı bir hatayı ona yüklemek olurdu.
 *
 * Tekrar semantiği için bkz. `lib/schedule/exceptions.ts`.
 */
export function ExceptionDialog({
  open,
  branchId,
  timeZone,
  staff,
  defaultStaffProfileId,
  onClose,
  onCreated,
}: {
  open: boolean;
  branchId: string;
  timeZone: string;
  staff: readonly StaffProfile[];
  defaultStaffProfileId: string;
  onClose: () => void;
  onCreated: () => void;
}): ReactNode {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {open ? (
          <ExceptionForm
            branchId={branchId}
            timeZone={timeZone}
            staff={staff}
            defaultStaffProfileId={defaultStaffProfileId}
            onClose={onClose}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ExceptionForm({
  branchId,
  timeZone,
  staff,
  defaultStaffProfileId,
  onClose,
  onCreated,
}: {
  branchId: string;
  timeZone: string;
  staff: readonly StaffProfile[];
  defaultStaffProfileId: string;
  onClose: () => void;
  onCreated: () => void;
}): ReactNode {
  const [draft, setDraft] = useState<ExceptionDraft>(() => ({
    ...emptyExceptionDraft(todayKey(timeZone)),
    staffProfileId: defaultStaffProfileId,
  }));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = validateException(draft);
  const shown = submitted ? errors : {};
  const patch = (next: Partial<ExceptionDraft>): void => setDraft((current) => ({ ...current, ...next }));
  const timed = draft.kind === 'weekly' || !draft.allDay;

  async function submit(): Promise<void> {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('schedule-exceptions', toExceptionBody(draft, branchId, timeZone), { branchId });
      toast.success(t('schedule.exceptionCreated'));
      onCreated();
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
        <DialogTitle>{t('schedule.exceptionNew')}</DialogTitle>
        <DialogDescription>{t('schedule.exceptionsEmptyHint')}</DialogDescription>
      </DialogHeader>

      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      <FieldSelect
        label={t('schedule.pickStaff')}
        value={draft.staffProfileId}
        error={shown.staffProfileId}
        onChange={(event) => patch({ staffProfileId: event.target.value })}
      >
        <option value="">—</option>
        {staff.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.userFullName}
          </option>
        ))}
      </FieldSelect>

      <div className="flex flex-col gap-2">
        <Label>{t('schedule.exceptionKind')}</Label>
        <Segmented label={t('schedule.exceptionKind')}>
          <SegmentButton pressed={draft.kind === 'once'} onClick={() => patch({ kind: 'once' })}>
            {t('schedule.exceptionOnce')}
          </SegmentButton>
          <SegmentButton pressed={draft.kind === 'weekly'} onClick={() => patch({ kind: 'weekly' })}>
            {t('schedule.exceptionWeekly')}
          </SegmentButton>
        </Segmented>
      </div>

      {draft.kind === 'once' ? (
        <>
          <FieldSwitch
            label={t('schedule.exceptionAllDay')}
            checked={draft.allDay}
            onCheckedChange={(allDay) => patch({ allDay })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Field
                label={t('schedule.exceptionFromDate')}
                type="date"
                value={draft.startDate}
                error={shown.startDate}
                onChange={(event) =>
                  patch({
                    startDate: event.target.value,
                    // Bitiş başlangıcın gerisinde kalmasın — en sık hata.
                    ...(draft.endDate < event.target.value ? { endDate: event.target.value } : {}),
                  })
                }
              />
              {timed ? (
                <Field
                  label={t('schedule.start')}
                  type="time"
                  step={300}
                  value={draft.startTime}
                  error={shown.startTime}
                  onChange={(event) => patch({ startTime: event.target.value })}
                />
              ) : null}
            </div>
            <div className="flex flex-col gap-3">
              <Field
                label={t('schedule.exceptionToDate')}
                type="date"
                min={draft.startDate}
                value={draft.endDate}
                error={shown.endDate}
                onChange={(event) => patch({ endDate: event.target.value })}
              />
              {timed ? (
                <Field
                  label={t('schedule.end')}
                  type="time"
                  step={300}
                  value={draft.endTime}
                  error={shown.endTime}
                  onChange={(event) => patch({ endTime: event.target.value })}
                />
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <WeekdayPicker
              label={t('schedule.exceptionWeekdays')}
              value={draft.weekdays}
              onChange={(weekdays) => patch({ weekdays })}
            />
            {shown.weekdays === undefined ? null : (
              <p role="alert" className="text-sm text-destructive">
                {shown.weekdays}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t('schedule.start')}
              type="time"
              step={300}
              value={draft.startTime}
              error={shown.startTime}
              onChange={(event) => patch({ startTime: event.target.value })}
            />
            <Field
              label={t('schedule.end')}
              type="time"
              step={300}
              value={draft.endTime}
              error={shown.endTime}
              onChange={(event) => patch({ endTime: event.target.value })}
            />
            <Field
              label={t('schedule.exceptionFirstDay')}
              type="date"
              value={draft.startDate}
              error={shown.startDate}
              onChange={(event) => patch({ startDate: event.target.value })}
            />
            <Field
              label={t('schedule.exceptionUntil')}
              type="date"
              min={draft.startDate}
              value={draft.untilDate}
              error={shown.untilDate}
              onChange={(event) => patch({ untilDate: event.target.value })}
            />
            <Field
              label={t('schedule.exceptionInterval')}
              type="number"
              inputMode="numeric"
              min={1}
              max={52}
              value={String(draft.intervalWeeks)}
              error={shown.intervalWeeks}
              onChange={(event) => patch({ intervalWeeks: Number.parseInt(event.target.value, 10) })}
            />
          </div>
        </>
      )}

      <Field
        label={t('schedule.exceptionReason')}
        value={draft.reason}
        maxLength={200}
        onChange={(event) => patch({ reason: event.target.value })}
      />

      <DialogFooter>
        <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={saving}>
          {t('schedule.exceptionAdd')}
        </Button>
      </DialogFooter>
    </form>
  );
}
