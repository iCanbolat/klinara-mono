'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { BranchDetail, CreateBranchInput, UpdateBranchInput } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { slugify, timeZoneOptions } from '@/lib/branches/slug';
import { errorFor, toFormErrors, type FormErrors } from '@/lib/forms/field-errors';
import { Alert } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldSelect, FieldSwitch, FieldTextarea } from '@/components/ui/field';

const NO_ERRORS: FormErrors = { message: null, fields: {}, requestId: null };

/**
 * Şube oluşturma / düzenleme.
 *
 * - **Kod (slug)** addan türetiliyor, kullanıcı alana dokunduğu anda türetme
 *   duruyor. Oluşturulduktan sonra DEĞİŞMEZ (uç kabul etmiyor) — düzenlemede
 *   salt okunur gösteriliyor.
 * - **Pasife alma** geri alınabilir ama etkisi büyük (yeni randevu yok, şube
 *   seçicilerden kalkıyor): kaydederken ayrıca onay soruluyor. Aktif etmek
 *   sorulmuyor.
 * - `PATCH` yalnız DEĞİŞEN alanları gönderiyor; boş telefon/adres `null` =
 *   temizle.
 */
export function BranchFormDialog({
  open,
  branch,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** `null` = oluşturma. */
  branch: BranchDetail | null;
  onClose: () => void;
  onSaved: (branch: BranchDetail) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [timezone, setTimezone] = useState('Europe/Istanbul');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      await Promise.resolve();
      setName(branch?.name ?? '');
      setSlug(branch?.slug ?? '');
      setSlugTouched(branch !== null);
      setTimezone(branch?.timezone ?? 'Europe/Istanbul');
      setPhone(branch?.phone ?? '');
      setAddress(branch?.address ?? '');
      setActive(branch?.isActive ?? true);
      setErrors(NO_ERRORS);
      setBusy(false);
    })();
  }, [open, branch]);

  const zones = useMemo(() => timeZoneOptions(branch?.timezone), [branch?.timezone]);

  const deactivating = branch !== null && branch.isActive && !active;

  async function submit(): Promise<void> {
    setConfirmDeactivate(false);
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      let saved: BranchDetail;
      if (branch === null) {
        const body: CreateBranchInput = {
          slug: slug.trim(),
          name: name.trim(),
          timezone,
          ...(phone.trim() === '' ? {} : { phone: phone.trim() }),
          ...(address.trim() === '' ? {} : { address: address.trim() }),
        };
        saved = await api.post<BranchDetail>('branches', body);
        toast.success(t('branches.created'));
      } else {
        const body: UpdateBranchInput = {};
        if (name.trim() !== branch.name) body.name = name.trim();
        if (timezone !== branch.timezone) body.timezone = timezone;
        if (phone.trim() !== (branch.phone ?? ''))
          body.phone = phone.trim() === '' ? null : phone.trim();
        if (address.trim() !== (branch.address ?? '')) {
          body.address = address.trim() === '' ? null : address.trim();
        }
        if (active !== branch.isActive) body.isActive = active;
        saved = await api.patch<BranchDetail>(`branches/${branch.id}`, body);
        toast.success(t('branches.saved'));
      }
      onSaved(saved);
    } catch (caught) {
      const formErrors = toFormErrors(caught);
      // Kod çakışması bir alan hatası olarak gelmiyor (409); kullanıcının
      // düzelteceği yer kod alanı, mesaj oraya taşınıyor.
      if (branch === null && formErrors.message !== null && /kod|slug/i.test(formErrors.message)) {
        setErrors({
          ...formErrors,
          fields: { ...formErrors.fields, slug: formErrors.message },
          message: null,
        });
      } else {
        setErrors(formErrors);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{branch === null ? t('branches.new') : t('branches.edit')}</DialogTitle>
            {branch === null ? null : <DialogDescription>{branch.name}</DialogDescription>}
          </DialogHeader>

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (deactivating) setConfirmDeactivate(true);
              else void submit();
            }}
          >
            {errors.message !== null ? <Alert tone="danger">{errors.message}</Alert> : null}
            <Field
              label={t('branches.name')}
              required
              maxLength={200}
              value={name}
              disabled={busy}
              error={errorFor(errors, 'name')}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched) setSlug(slugify(event.target.value));
              }}
            />
            <Field
              label={t('branches.slug')}
              hint={t('branches.slugHint')}
              required
              minLength={3}
              maxLength={50}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={slug}
              readOnly={branch !== null}
              disabled={busy}
              {...(branch === null ? {} : { className: 'bg-muted text-muted-foreground' })}
              error={errorFor(errors, 'slug')}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value.toLowerCase());
              }}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldSelect
                label={t('branches.timezone')}
                value={timezone}
                disabled={busy}
                error={errorFor(errors, 'timezone')}
                onChange={(event) => setTimezone(event.target.value)}
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </FieldSelect>
              <Field
                label={t('branches.phone')}
                type="tel"
                autoComplete="tel"
                value={phone}
                disabled={busy}
                error={errorFor(errors, 'phone')}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            <FieldTextarea
              label={t('branches.address')}
              rows={2}
              value={address}
              disabled={busy}
              error={errorFor(errors, 'address')}
              onChange={(event) => setAddress(event.target.value)}
            />
            {branch === null ? null : (
              <FieldSwitch
                label={t('branches.active')}
                hint={t('branches.activeHint')}
                checked={active}
                disabled={busy}
                onCheckedChange={setActive}
                className="rounded-lg border border-border px-3"
              />
            )}

            <DialogFooter>
              <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy || name.trim() === '' || slug.trim().length < 3}>
                {busy ? t('common.loading') : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('branches.deactivateTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('branches.deactivateBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void submit()}
            >
              {t('branches.deactivateConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
