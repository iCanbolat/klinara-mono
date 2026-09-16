'use client';

import { useMemo, useRef, type ReactNode } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
import type { Branch, Me } from '@klinara/shared';
import { t } from '@/i18n/tr';
import {
  assignableRolesFor,
  isTenantScoped,
  membershipLock,
  roleName,
  validateMemberships,
  type MembershipDraft,
} from '@/lib/staff/memberships';
import { Button } from '@/components/ui/button';
import { FieldSelect } from '@/components/ui/field';

/**
 * Rol + şube satırları. Durum çağıranda (taslak/karşılaştırma orada); bu
 * bileşen yalnız satırları çiziyor ve kilitleri gösteriyor.
 *
 * Kilitli satır (sizden yetkili rol) GÖRÜNÜR ve olduğu gibi geri gönderiliyor:
 * gizlemek, `PUT` tam değiştirme olduğu için o rolü sessizce silmeye
 * çalışmak olurdu.
 */
export function MembershipEditor({
  me,
  rows,
  branches,
  disabled,
  onChange,
}: {
  me: Me;
  rows: readonly MembershipDraft[];
  branches: readonly Branch[];
  disabled: boolean;
  onChange: (rows: MembershipDraft[]) => void;
}): ReactNode {
  const roles = assignableRolesFor(me);
  const issues = useMemo(() => validateMemberships(rows), [rows]);
  const nextKey = useRef(0);

  // Yalnız ERİŞEBİLDİĞİM ve aktif şubeler atanabilir; mevcut satırın şubesi
  // pasifse de seçenek olarak kalıyor (seçim kaybolmasın).
  const assignable = branches.filter(
    (branch) => (me.tenantWide || me.branchIds.includes(branch.id)) && branch.isActive !== false,
  );

  function update(key: string, patch: Partial<MembershipDraft>): void {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function add(): void {
    nextKey.current += 1;
    const roleKey = roles.find((role) => !isTenantScoped(role)) ?? roles[0] ?? 'practitioner';
    onChange([
      ...rows,
      {
        // Yalnız React anahtarı; sunucu kimliği değil.
        key: `new-${nextKey.current}`,
        roleKey,
        branchId: isTenantScoped(roleKey) ? null : (assignable[0]?.id ?? null),
      },
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          {t('members.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const lock = membershipLock(me, row);
            const issue = issues[row.key];
            const tenantScoped = isTenantScoped(row.roleKey);
            const rowDisabled = disabled || lock !== null;
            const branchOptions = assignable.some((branch) => branch.id === row.branchId)
              ? assignable
              : [...assignable, ...branches.filter((branch) => branch.id === row.branchId)];

            return (
              <li
                key={row.key}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <FieldSelect
                    label={t('members.role')}
                    value={row.roleKey}
                    disabled={rowDisabled}
                    onChange={(event) => {
                      const roleKey = event.target.value;
                      update(row.key, {
                        roleKey,
                        branchId: isTenantScoped(roleKey)
                          ? null
                          : (row.branchId ?? assignable[0]?.id ?? null),
                      });
                    }}
                  >
                    {/* Kilitli satırın rolü atanabilirler arasında değil; yine de gösterilmeli. */}
                    {roles.includes(row.roleKey as (typeof roles)[number]) ? null : (
                      <option value={row.roleKey}>{roleName(row.roleKey)}</option>
                    )}
                    {roles.map((role) => (
                      <option key={role} value={role}>
                        {roleName(role)}
                      </option>
                    ))}
                  </FieldSelect>

                  {tenantScoped ? (
                    <div className="flex h-11 items-center rounded-lg bg-muted px-3 text-sm text-muted-foreground sm:self-end">
                      {t('staff.tenantWide')}
                    </div>
                  ) : (
                    <FieldSelect
                      label={t('members.branch')}
                      value={row.branchId ?? ''}
                      disabled={rowDisabled}
                      error={issue === 'branchRequired' ? t('members.branchRequired') : undefined}
                      onChange={(event) =>
                        update(row.key, {
                          branchId: event.target.value === '' ? null : event.target.value,
                        })
                      }
                    >
                      <option value="">{t('members.pickBranch')}</option>
                      {branchOptions.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                      {row.branchId !== null &&
                      !branches.some((branch) => branch.id === row.branchId) ? (
                        <option value={row.branchId}>{t('staff.inaccessibleBranch')}</option>
                      ) : null}
                    </FieldSelect>
                  )}

                  {lock === null ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 justify-self-end"
                      disabled={disabled}
                      aria-label={`${t('members.remove')}: ${roleName(row.roleKey)}`}
                      onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : (
                    <span
                      className="flex size-11 items-center justify-center justify-self-end text-muted-foreground"
                      title={lock === 'rank' ? t('members.lockRank') : t('staff.inaccessibleBranch')}
                    >
                      <Lock aria-hidden="true" className="size-4" />
                      <span className="sr-only">
                        {lock === 'rank' ? t('members.lockRank') : t('staff.inaccessibleBranch')}
                      </span>
                    </span>
                  )}
                </div>
                {issue === 'duplicate' ? (
                  <p role="alert" className="text-xs text-destructive">
                    {t('members.duplicate')}
                  </p>
                ) : null}
                {lock === 'rank' ? (
                  <p className="text-xs text-muted-foreground">{t('members.lockRank')}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {disabled ? null : (
        <Button type="button" variant="secondary" size="sm" className="self-start" onClick={add}>
          <Plus aria-hidden="true" />
          {t('members.add')}
        </Button>
      )}
    </div>
  );
}
