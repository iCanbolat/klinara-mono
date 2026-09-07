'use client';

import { useState, type ReactNode } from 'react';
import type { Service, StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { Button } from '@/components/ui/button';
import { FieldCheckbox } from '@/components/ui/field';

/**
 * Hizmet yetkinlik matrisi.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ `PUT /staff/:id/services` TAM DEĞİŞTİRME
 * ---------------------------------------------------------------------------
 * Gönderilen dizi personelin yetkinliklerinin TAMAMI olur: işareti kaldırılan
 * hizmet SİLİNİR. Bu yüzden form açılırken MEVCUT TAM liste okunuyor ve
 * kaydederken tamamı gönderiliyor.
 *
 * Kullanıcıya söyleniyor: "yalnız işaretlediklerin kalır" bilgisi olmadan,
 * bir hizmeti eklemek için gelen kişi diğerlerini farkında olmadan silebilir.
 *
 * ---------------------------------------------------------------------------
 * PASİF HİZMET SEÇİLİYSE GÖSTERİLİYOR
 * ---------------------------------------------------------------------------
 * `category-picker.tsx`in aynı kararı: seçili bir kaydı listeden gizlemek,
 * kaldırılamayan bir seçim demek.
 */
export function CompetencyMatrix({
  profile,
  services,
  onCancel,
  onSave,
}: {
  profile: StaffProfile;
  services: readonly Service[];
  onCancel: () => void;
  onSave: (serviceIds: string[]) => void;
}): ReactNode {
  // MEVCUT TAM liste — bkz. dosya başlığı.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(profile.services.filter((link) => link.isActive).map((link) => link.serviceId)),
  );

  // Pasif hizmet SEÇİLİYSE listede kalıyor; seçili değilse gizleniyor.
  const visible = services.filter((service) => service.isActive || selected.has(service.id));

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{t('staff.competencyHint')}</p>

      <div className="grid gap-1 sm:grid-cols-2">
        {visible.map((service) => (
          <FieldCheckbox
            key={service.id}
            label={service.isActive ? service.name : `${service.name} (pasif)`}
            checked={selected.has(service.id)}
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

      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={() => onSave([...selected])}>
          {t('customers.save')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('calendar.detail.close')}
        </Button>
      </div>
    </div>
  );
}
