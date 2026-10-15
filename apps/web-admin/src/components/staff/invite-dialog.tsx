'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { CreateInvitationInput, Invitation, Service } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { errorFor, toFormErrors, type FormErrors } from '@/lib/forms/field-errors';
import { assignableRolesFor, isTenantScoped, roleName } from '@/lib/staff/memberships';
import { useBranch } from '@/components/session/branch-provider';
import { useSession } from '@/components/session/session-provider';
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
import { Field, FieldCheckbox, FieldSelect, FieldSwitch } from '@/components/ui/field';

const NO_ERRORS: FormErrors = { message: null, fields: {}, requestId: null };

/**
 * Personel daveti: e-posta + rol (+ şube kapsamlı rolde şube).
 *
 * Uygulayıcı davetinde kabulle birlikte açılacak personel profili de burada
 * girilir (unvan, online görünürlük, hizmet yetkinlikleri); böylece kişi
 * hesabını açar açmaz takvimde randevu alabilir.
 *
 * Rol listesi yalnız ATAYABİLDİĞİM roller (rütbe kuralı); şube listesi yalnız
 * erişebildiğim AKTİF şubeler. Sunucu ikisini de ayrıca zorluyor.
 *
 * Kiracı kapsamlı rol seçilince şube alanı kaldırılıyor (gönderilirse 400).
 */
export function InviteDialog({
  open,
  onClose,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  onSent: (invitation: Invitation) => void;
}): ReactNode {
  const { me } = useSession();
  const { branches, branchId: activeBranchId } = useBranch();

  const roles = me === null ? [] : assignableRolesFor(me);
  const assignable = branches.filter(
    (branch) =>
      branch.isActive !== false &&
      (me === null || me.tenantWide || me.branchIds.includes(branch.id)),
  );

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleKey, setRoleKey] = useState('');
  const [branchId, setBranchId] = useState('');
  const [title, setTitle] = useState('');
  const [visibleOnline, setVisibleOnline] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [services, setServices] = useState<Service[]>([]);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      await Promise.resolve();
      setEmail('');
      setFullName('');
      setRoleKey(roles.includes('practitioner') ? 'practitioner' : (roles.at(-1) ?? ''));
      setBranchId(
        assignable.some((branch) => branch.id === activeBranchId)
          ? (activeBranchId ?? '')
          : (assignable[0]?.id ?? ''),
      );
      setTitle('');
      setVisibleOnline(true);
      setSelected(new Set());
      setErrors(NO_ERRORS);
      setBusy(false);
    })();
    // Diyalog her açılışta sıfırdan kuruluyor; liste değişimi taslağı ezmemeli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Hizmet listesi diyalog açılınca bir kez çekilir; alınamazsa davet yine de
  // gönderilebilir, profil hizmetleri sonradan da atanabilir.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void api
      .get<{ data: Service[] }>('services', { signal: controller.signal })
      .then((result) => setServices(result.data.filter((service) => service.isActive)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [open]);

  const tenantScoped = isTenantScoped(roleKey);
  const withProfile = roleKey === 'practitioner';

  async function submit(): Promise<void> {
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      const body: CreateInvitationInput = {
        email: email.trim(),
        roleKey,
        ...(fullName.trim() === '' ? {} : { fullName: fullName.trim() }),
        ...(tenantScoped || branchId === '' ? {} : { branchId }),
        ...(withProfile
          ? {
              staffProfile: {
                ...(title.trim() === '' ? {} : { title: title.trim() }),
                isVisibleOnline: visibleOnline,
                serviceIds: [...selected],
              },
            }
          : {}),
      };
      const invitation = await api.post<Invitation>('invitations', body);
      toast.success(t('invites.sent'));
      onSent(invitation);
    } catch (caught) {
      setErrors(toFormErrors(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('invites.new')}</DialogTitle>
          <DialogDescription>{t('invites.hint')}</DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            {errors.message !== null ? <Alert tone="danger">{errors.message}</Alert> : null}
            <Field
              label={t('invites.email')}
              type="email"
              autoComplete="off"
              required
              value={email}
              disabled={busy}
              error={errorFor(errors, 'email')}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Field
              label={t('invites.fullName')}
              value={fullName}
              maxLength={200}
              disabled={busy}
              error={errorFor(errors, 'fullName')}
              onChange={(event) => setFullName(event.target.value)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldSelect
                label={t('invites.role')}
                value={roleKey}
                disabled={busy}
                error={errorFor(errors, 'roleKey')}
                onChange={(event) => setRoleKey(event.target.value)}
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {roleName(role)}
                  </option>
                ))}
              </FieldSelect>
              {tenantScoped ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{t('invites.branch')}</span>
                  <div className="flex h-11 items-center rounded-lg bg-muted px-3 text-sm text-muted-foreground">
                    {t('staff.tenantWide')}
                  </div>
                </div>
              ) : (
                <FieldSelect
                  label={t('invites.branch')}
                  value={branchId}
                  required
                  disabled={busy}
                  error={errorFor(errors, 'branchId')}
                  onChange={(event) => setBranchId(event.target.value)}
                >
                  <option value="">{t('members.pickBranch')}</option>
                  {assignable.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </FieldSelect>
              )}
            </div>

            {withProfile ? (
              <div className="flex flex-col gap-4 border-t border-border pt-4">
                <p className="text-xs text-muted-foreground">{t('invites.profileHint')}</p>
                <Field
                  label={t('staff.jobTitle')}
                  value={title}
                  maxLength={100}
                  placeholder="ör. Dermatolog"
                  disabled={busy}
                  error={errorFor(errors, 'staffProfile.title')}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <FieldSwitch
                  label={t('staff.visibleOnline')}
                  checked={visibleOnline}
                  disabled={busy}
                  onCheckedChange={setVisibleOnline}
                />
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">{t('staff.competency')}</span>
                  {services.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('staff.noServices')}</p>
                  ) : (
                    <div className="grid gap-1 sm:grid-cols-2">
                      {services.map((service) => (
                        <FieldCheckbox
                          key={service.id}
                          label={service.name}
                          checked={selected.has(service.id)}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (checked) next.add(service.id);
                              else next.delete(service.id);
                              return next;
                            })
                          }
                        />
                      ))}
                    </div>
                  )}
                  {errorFor(errors, 'staffProfile.serviceIds') !== undefined ? (
                    <p className="text-xs text-destructive">
                      {errorFor(errors, 'staffProfile.serviceIds')}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                busy || email.trim() === '' || roleKey === '' || (!tenantScoped && branchId === '')
              }
            >
              {busy ? t('common.loading') : t('invites.new')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
