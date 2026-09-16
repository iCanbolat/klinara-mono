'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PERMISSIONS, type Membership, type StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { errorFor, toFormErrors, type FormErrors } from '@/lib/forms/field-errors';
import { toMessage } from '@/lib/reports/errors';
import {
  editorLock,
  sameMemberships,
  toDrafts,
  toInputs,
  validateMemberships,
  type MembershipDraft,
} from '@/lib/staff/memberships';
import { useBranch } from '@/components/session/branch-provider';
import { useSession } from '@/components/session/session-provider';
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
import { Field, FieldSelect, FieldSwitch } from '@/components/ui/field';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { MembershipEditor } from './membership-editor';

/** iOS `ColorSwatchPicker.palette` ile aynı sekiz renk. */
const PALETTE = [
  '#7F9A76',
  '#5E7856',
  '#1A6A7A',
  '#3F6E8C',
  '#8C6A3F',
  '#A6483C',
  '#7A5A8C',
  '#4A4F52',
];

const NO_ERRORS: FormErrors = { message: null, fields: {}, requestId: null };

interface ProfileDraft {
  title: string;
  primaryBranchId: string;
  calendarColor: string | null;
  isVisibleOnline: boolean;
  isActive: boolean;
}

function profileDraft(profile: StaffProfile): ProfileDraft {
  return {
    title: profile.title ?? '',
    primaryBranchId: profile.primaryBranchId ?? '',
    calendarColor: profile.calendarColor,
    isVisibleOnline: profile.isVisibleOnline,
    isActive: profile.isActive,
  };
}

/**
 * Personel düzenleme paneli: iki bağımsız bölüm, iki ayrı "Kaydet".
 *
 * Bölümler AYRI kaydediliyor çünkü iki ayrı uç ve iki ayrı izin var:
 * profil `PATCH staff/:id` (`staff:write`), roller `PUT users/:id/memberships`
 * (`user:write` VEYA `user:invite`). Tek düğme, biri başarılı biri 403 olan
 * bir kaydı kullanıcıya "yarım kaydedildi" diye anlatmak zorunda kalırdı.
 *
 * Kaydedilmemiş değişiklikle panel kapatılmak istenirse onay soruluyor.
 */
export function StaffEditSheet({
  profile,
  onClose,
  onSaved,
}: {
  /** `null` = kapalı. */
  profile: StaffProfile | null;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const { me, permissions } = useSession();
  const { branches } = useBranch();

  const canWriteProfile = permissions.includes(PERMISSIONS.STAFF_WRITE);
  const canReadUsers = permissions.includes(PERMISSIONS.USER_READ);
  const canWriteRoles =
    permissions.includes(PERMISSIONS.USER_WRITE) || permissions.includes(PERMISSIONS.USER_INVITE);

  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  // Karşılaştırma tabanı: açılıştaki profil, kayıttan sonra sunucunun döndüğü.
  const [baseline, setBaseline] = useState<ProfileDraft | null>(null);
  const [profileErrors, setProfileErrors] = useState<FormErrors>(NO_ERRORS);
  const [savingProfile, setSavingProfile] = useState(false);

  const [savedMemberships, setSavedMemberships] = useState<MembershipDraft[] | null>(null);
  const [rows, setRows] = useState<MembershipDraft[]>([]);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [savingRoles, setSavingRoles] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const profileId = profile?.id ?? null;
  const userId = profile?.userId ?? null;

  // Başka bir personel açılınca taslaklar render sırasında sıfırlanıyor —
  // effect'te sıfırlamak bir kare boyunca önceki kişinin verisini gösterirdi.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (loadedFor !== profileId) {
    setLoadedFor(profileId);
    setDraft(profile === null ? null : profileDraft(profile));
    setBaseline(profile === null ? null : profileDraft(profile));
    setProfileErrors(NO_ERRORS);
    setSavedMemberships(null);
    setRows([]);
    setMembershipError(null);
  }

  useEffect(() => {
    if (userId === null || !canReadUsers) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const { data } = await api.get<{ data: Membership[] }>(`users/${userId}/memberships`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const drafts = toDrafts(data);
        setSavedMemberships(drafts);
        setRows(drafts);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setMembershipError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [userId, canReadUsers]);

  const profileDirty =
    draft !== null && baseline !== null && JSON.stringify(draft) !== JSON.stringify(baseline);
  const rolesDirty = savedMemberships !== null && !sameMemberships(rows, savedMemberships);
  const issues = useMemo(() => validateMemberships(rows), [rows]);
  const hasIssues = Object.keys(issues).length > 0;

  const lock =
    me === null || userId === null || savedMemberships === null
      ? null
      : editorLock(me, userId, savedMemberships);
  const rolesEditable = canWriteRoles && lock === null;

  function requestClose(): void {
    if (profileDirty || rolesDirty) setConfirmClose(true);
    else onClose();
  }

  async function saveProfile(): Promise<void> {
    if (profile === null || draft === null || baseline === null) return;
    const initial = baseline;
    // Yalnız DEĞİŞEN alanlar gidiyor; boş bırakılan metin `null` = temizle.
    const body: Record<string, unknown> = {};
    if (draft.title.trim() !== initial.title)
      body.title = draft.title.trim() === '' ? null : draft.title.trim();
    if (draft.primaryBranchId !== initial.primaryBranchId) {
      body.primaryBranchId = draft.primaryBranchId === '' ? null : draft.primaryBranchId;
    }
    if (draft.calendarColor !== initial.calendarColor) body.calendarColor = draft.calendarColor;
    if (draft.isVisibleOnline !== initial.isVisibleOnline)
      body.isVisibleOnline = draft.isVisibleOnline;
    if (draft.isActive !== initial.isActive) body.isActive = draft.isActive;

    setSavingProfile(true);
    setProfileErrors(NO_ERRORS);
    try {
      const updated = await api.patch<StaffProfile>(`staff/${profile.id}`, body);
      setDraft(profileDraft(updated));
      setBaseline(profileDraft(updated));
      toast.success(t('staff.profileSaved'));
      onSaved();
    } catch (caught) {
      setProfileErrors(toFormErrors(caught));
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveRoles(): Promise<void> {
    if (userId === null || hasIssues) return;
    setConfirmEmpty(false);
    setSavingRoles(true);
    setMembershipError(null);
    try {
      // TAM DEĞİŞTİRME: kilitli satırlar da olduğu gibi gönderiliyor.
      const { data } = await api.put<{ data: Membership[] }>(`users/${userId}/memberships`, {
        memberships: toInputs(rows),
      });
      const drafts = toDrafts(data);
      setSavedMemberships(drafts);
      setRows(drafts);
      toast.success(t('members.saved'));
      onSaved();
    } catch (caught) {
      setMembershipError(toMessage(caught));
    } finally {
      setSavingRoles(false);
    }
  }

  // Ana şube seçenekleri: erişebildiğim aktif şubeler + mevcut değer.
  const primaryOptions = branches.filter(
    (branch) =>
      branch.id === draft?.primaryBranchId ||
      (branch.isActive !== false &&
        (me === null || me.tenantWide || me.branchIds.includes(branch.id))),
  );
  const primaryUnknown =
    draft !== null &&
    draft.primaryBranchId !== '' &&
    !branches.some((branch) => branch.id === draft.primaryBranchId);

  return (
    <>
      <Sheet open={profile !== null} onOpenChange={(next) => !next && requestClose()}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
          {profile === null || draft === null ? null : (
            <>
              <SheetHeader className="border-b border-border">
                <SheetTitle>{profile.userFullName}</SheetTitle>
                <SheetDescription>{profile.userEmail}</SheetDescription>
              </SheetHeader>

              {/* --- Profil --- */}
              <section aria-labelledby="staff-profile-heading" className="flex flex-col gap-4 p-4">
                <h3 id="staff-profile-heading" className="text-body-emphasis text-foreground">
                  {t('staff.profileSection')}
                </h3>
                {profileErrors.message !== null ? (
                  <Alert tone="danger">{profileErrors.message}</Alert>
                ) : null}
                <Field
                  label={t('staff.jobTitle')}
                  value={draft.title}
                  maxLength={100}
                  disabled={!canWriteProfile || savingProfile}
                  error={errorFor(profileErrors, 'title')}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
                <FieldSelect
                  label={t('staff.branch')}
                  hint={t('staff.primaryBranchHint')}
                  value={draft.primaryBranchId}
                  disabled={!canWriteProfile || savingProfile}
                  error={errorFor(profileErrors, 'primaryBranchId')}
                  onChange={(event) => setDraft({ ...draft, primaryBranchId: event.target.value })}
                >
                  <option value="">{t('staff.noPrimaryBranch')}</option>
                  {primaryOptions.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                  {primaryUnknown ? (
                    <option value={draft.primaryBranchId}>{t('staff.inaccessibleBranch')}</option>
                  ) : null}
                </FieldSelect>

                <fieldset
                  className="flex flex-col gap-2"
                  disabled={!canWriteProfile || savingProfile}
                >
                  <legend className="mb-1.5 text-sm font-medium">{t('staff.calendarColor')}</legend>
                  <div className="flex flex-wrap gap-2">
                    {PALETTE.map((color) => {
                      const selected = draft.calendarColor?.toUpperCase() === color;
                      return (
                        <button
                          key={color}
                          type="button"
                          aria-pressed={selected}
                          aria-label={color}
                          onClick={() =>
                            setDraft({ ...draft, calendarColor: selected ? null : color })
                          }
                          className={cn(
                            'size-9 rounded-full border-2 transition disabled:opacity-50',
                            selected
                              ? 'border-foreground ring-2 ring-ring ring-offset-2'
                              : 'border-transparent',
                          )}
                          style={{ backgroundColor: color }}
                        />
                      );
                    })}
                  </div>
                </fieldset>

                <div className="flex flex-col divide-y divide-border rounded-lg border border-border px-3">
                  <FieldSwitch
                    label={t('staff.visibleOnline')}
                    checked={draft.isVisibleOnline}
                    disabled={!canWriteProfile || savingProfile}
                    onCheckedChange={(checked) => setDraft({ ...draft, isVisibleOnline: checked })}
                  />
                  <FieldSwitch
                    label={t('staff.active')}
                    hint={t('staff.activeHint')}
                    checked={draft.isActive}
                    disabled={!canWriteProfile || savingProfile}
                    onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })}
                  />
                </div>

                {canWriteProfile ? (
                  <Button
                    type="button"
                    className="self-end"
                    disabled={!profileDirty || savingProfile}
                    onClick={() => void saveProfile()}
                  >
                    {savingProfile ? t('common.loading') : t('staff.saveProfile')}
                  </Button>
                ) : null}
              </section>

              {/* --- Roller ve şubeler --- */}
              <section
                aria-labelledby="staff-roles-heading"
                className="flex flex-col gap-4 border-t border-border p-4"
              >
                <div className="flex flex-col gap-1">
                  <h3 id="staff-roles-heading" className="text-body-emphasis text-foreground">
                    {t('members.title')}
                  </h3>
                  <p className="text-xs text-muted-foreground">{t('members.description')}</p>
                </div>

                {!canReadUsers ? (
                  <Alert tone="info">{t('members.noUserAccess')}</Alert>
                ) : savedMemberships === null ? (
                  membershipError !== null ? (
                    <Alert tone="danger">{membershipError}</Alert>
                  ) : (
                    <div className="flex flex-col gap-2" aria-busy="true">
                      <Skeleton className="h-20 w-full rounded-lg" />
                      <Skeleton className="h-20 w-full rounded-lg" />
                    </div>
                  )
                ) : (
                  <>
                    {lock === 'self' ? (
                      <Alert tone="info">{t('members.lockSelf')}</Alert>
                    ) : lock === 'branch' ? (
                      <Alert tone="info">{t('members.lockBranch')}</Alert>
                    ) : !canWriteRoles ? (
                      <Alert tone="info">{t('members.readOnly')}</Alert>
                    ) : null}
                    {membershipError !== null ? (
                      <Alert tone="danger">{membershipError}</Alert>
                    ) : null}
                    {me === null ? null : (
                      <MembershipEditor
                        me={me}
                        rows={rows}
                        branches={branches}
                        disabled={!rolesEditable || savingRoles}
                        onChange={setRows}
                      />
                    )}
                    {rolesEditable ? (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {rolesDirty ? (
                          <>
                            <span className="mr-auto text-xs text-muted-foreground">
                              {t('members.unsaved')}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={savingRoles}
                              onClick={() => setRows(savedMemberships)}
                            >
                              {t('schedule.discard')}
                            </Button>
                          </>
                        ) : null}
                        <Button
                          type="button"
                          disabled={!rolesDirty || hasIssues || savingRoles}
                          onClick={() =>
                            rows.length === 0 ? setConfirmEmpty(true) : void saveRoles()
                          }
                        >
                          {savingRoles ? t('common.loading') : t('members.save')}
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </section>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('members.removeAllTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('members.removeAllBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void saveRoles()}
            >
              {t('members.removeAllConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('schedule.leaveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('schedule.leaveBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClose(false);
                onClose();
              }}
            >
              {t('schedule.leaveConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
