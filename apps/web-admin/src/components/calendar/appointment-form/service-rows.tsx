'use client';

import type { ReactNode } from 'react';
import type { Service, StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { Button } from '@/components/ui/button';
import { FieldSelect } from '@/components/ui/field';
import { errorFor, fieldPath, type FormErrors } from '@/lib/forms/field-errors';
import type { FormAction, ServiceRow } from './state';

/**
 * Hizmet + personel satırları.
 *
 * ---------------------------------------------------------------------------
 * NEDEN COMBOBOX DEĞİL, YEREL `<select>`
 * ---------------------------------------------------------------------------
 * `GET /services` ve `GET /staff` SAYFALANMIYOR ve süzgeç almıyor: tüm liste
 * tek istekte geliyor. Arama sunucuda olmadığı için async bir seçiciye gerek
 * yok, ve `FieldSelect` bilerek yerel `<select>` kullanıyor — mobil klavye,
 * ekran okuyucu ve klavye gezinmesi bedava doğru geliyor.
 *
 * (Müşteri farklı: defter binlerce satır ve arama sunucuda; orada `Combobox`
 * kullanılıyor.)
 *
 * ---------------------------------------------------------------------------
 * PERSONEL SÜZGECİ
 * ---------------------------------------------------------------------------
 * Personel listesi seçilen HİZMETE göre daraltılıyor: yetkin olmayan bir
 * personel seçilirse sunucu reddediyor ve kullanıcı sebebi anlamıyor.
 * Yetkinlik `staff.services[]` üzerinden okunuyor.
 *
 * ⚠️ `GET /staff` şube süzgeci ALMIYOR (API tarafında açık madde). Liste
 * istemcide `primaryBranchId` ile daraltılıyor; birincil şubesi başka olup
 * bu şubede de çalışan bir personel listede görünmez. Sunucu tarafında
 * `?branchId` süzgeci eklenene kadar kabul edilen sınır bu.
 */

export function ServiceRows({
  rows,
  services,
  staff,
  branchId,
  errors,
  disabled,
  dispatch,
}: {
  rows: readonly ServiceRow[];
  services: readonly Service[];
  staff: readonly StaffProfile[];
  branchId: string;
  errors: FormErrors;
  disabled: boolean;
  dispatch: (action: FormAction) => void;
}): ReactNode {
  const activeServices = services.filter((service) => service.isActive);

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, index) => {
        const eligible = staff.filter(
          (profile) =>
            profile.isActive &&
            // Şube daralması — yukarıdaki uyarıya bakın.
            (profile.primaryBranchId === null || profile.primaryBranchId === branchId) &&
            (row.serviceId === null ||
              profile.services.some(
                (link) => link.serviceId === row.serviceId && link.isActive,
              )),
        );

        return (
          <div key={index} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldSelect
                label={t('calendar.create.service')}
                value={row.serviceId ?? ''}
                disabled={disabled}
                error={errorFor(errors, fieldPath('services', index, 'serviceId'))}
                onChange={(event) =>
                  dispatch({
                    type: 'service',
                    index,
                    serviceId: event.target.value === '' ? null : event.target.value,
                  })
                }
              >
                <option value="">—</option>
                {activeServices.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} ({service.durationMinutes} dk)
                  </option>
                ))}
              </FieldSelect>

              <FieldSelect
                label={t('calendar.create.staff')}
                value={row.staffProfileId ?? ''}
                // Hizmet seçilmeden personel seçtirmek, listeyi daraltmadan
                // göstermek demek: kullanıcı yetkin olmayan birini seçer ve
                // sonra hizmet seçince seçimi sessizce kaybolur.
                disabled={disabled || row.serviceId === null}
                error={errorFor(errors, fieldPath('services', index, 'staffProfileId'))}
                onChange={(event) =>
                  dispatch({
                    type: 'staff',
                    index,
                    staffProfileId: event.target.value === '' ? null : event.target.value,
                  })
                }
              >
                <option value="">—</option>
                {eligible.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.userFullName}
                  </option>
                ))}
              </FieldSelect>
            </div>

            {rows.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => dispatch({ type: 'removeRow', index })}
                className="self-start"
              >
                {t('calendar.create.removeService')}
              </Button>
            ) : null}
          </div>
        );
      })}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => dispatch({ type: 'addRow' })}
        className="self-start"
      >
        {t('calendar.create.addService')}
      </Button>
    </div>
  );
}
