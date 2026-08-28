import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { roundHalfEven } from '../../common/money';
import type { Tx } from '../../database/tenant-tx';
import type {
  CommissionBasis,
  CommissionCalcKind,
  CommissionScope,
  CommissionTrigger,
} from '../../database/schema';

interface ResolvedRule {
  id: string;
  calcKind: CommissionCalcKind;
  value: number;
  basis: CommissionBasis;
  triggerOn: CommissionTrigger;
}

interface AccrualTarget {
  chargeId: string;
  branchId: string;
  staffProfileId: string;
  scope: CommissionScope;
  scopeRefId: string | null;
  /** Matrahın adayları — hangisinin kullanılacağını kuralın `basis`i seçer. */
  servicePriceMinor: number;
  netAfterDiscountMinor: number;
}

/**
 * Prim tahakkuku.
 *
 * ⚠️ Bu servis TRANSACTION AÇMAZ; `tx`'i parametre olarak alır ve tetikleyen
 * işlemin transaction'ında koşar. Deseni `package-consumption.service.ts` ve
 * `charge-generation.service.ts` ile aynı: prim, kendisini doğuran olayla
 * birlikte ya olur ya olmaz.
 */
@Injectable()
export class CommissionAccrualService {
  /**
   * Randevu tamamlandığında prim yazar (`service_completed`).
   *
   * Her ücret kalemi için TEK kural çözülür ve TEK tahakkuk yazılır.
   * `commission_accruals_charge_once` kısmi tekil indeksi ikinci bir
   * tamamlama priminin yazılmasını engeller.
   */
  async accrueForAppointment(
    tx: Tx,
    params: { tenantId: string; appointmentId: string; actorUserId: string },
  ): Promise<number> {
    const targets = await CommissionAccrualService.appointmentTargets(
      tx,
      params.appointmentId,
    );
    let written = 0;

    for (const target of targets) {
      const rule = await CommissionAccrualService.resolveRule(tx, target, 'service_completed');
      if (rule === undefined) continue;

      const basisMinor =
        rule.basis === 'service_price'
          ? target.servicePriceMinor
          : target.netAfterDiscountMinor;
      const amountMinor = CommissionAccrualService.compute(rule, basisMinor);
      if (amountMinor === 0) continue;

      const periodId = await CommissionAccrualService.openPeriod(
        tx,
        params.tenantId,
        target.branchId,
      );

      await tx.execute(sql`
        insert into commission_accruals (
          tenant_id, branch_id, staff_profile_id, period_id,
          rule_id, rule_calc_kind, rule_value, rule_basis, trigger_on,
          charge_id, basis_minor, amount_minor, actor_user_id
        ) values (
          ${params.tenantId}::uuid, ${target.branchId}::uuid,
          ${target.staffProfileId}::uuid, ${periodId}::uuid,
          ${rule.id}::uuid, ${rule.calcKind}::commission_calc_kind,
          ${rule.value}, ${rule.basis}::commission_basis,
          'service_completed'::commission_trigger,
          ${target.chargeId}::uuid, ${basisMinor}, ${amountMinor},
          ${params.actorUserId}::uuid
        )
        on conflict do nothing
      `);
      written += 1;
    }
    return written;
  }

  /**
   * Tahsilat yapıldığında prim yazar (`payment_received`).
   *
   * KISMİ TAHSİLAT ORANSAL PRİM üretir: matrah, kaleme tahsis edilen tutardır.
   * Kalemin tamamı tahsil edilirse tahakkukların toplamı, tek seferde tahsil
   * edilmiş hâliyle aynı çıkar — `roundHalfEven` sapma biriktirmediği için.
   */
  async accrueForPayment(
    tx: Tx,
    params: { tenantId: string; paymentId: string; actorUserId: string },
  ): Promise<number> {
    const targets = await CommissionAccrualService.paymentTargets(tx, params.paymentId);
    let written = 0;

    for (const { target, allocatedMinor } of targets) {
      const rule = await CommissionAccrualService.resolveRule(tx, target, 'payment_received');
      if (rule === undefined) continue;

      const basisMinor =
        rule.basis === 'collected_amount'
          ? allocatedMinor
          : rule.basis === 'service_price'
            ? target.servicePriceMinor
            : target.netAfterDiscountMinor;
      const amountMinor = CommissionAccrualService.compute(rule, basisMinor);
      if (amountMinor === 0) continue;

      const periodId = await CommissionAccrualService.openPeriod(
        tx,
        params.tenantId,
        target.branchId,
      );

      await tx.execute(sql`
        insert into commission_accruals (
          tenant_id, branch_id, staff_profile_id, period_id,
          rule_id, rule_calc_kind, rule_value, rule_basis, trigger_on,
          charge_id, payment_id, basis_minor, amount_minor, actor_user_id
        ) values (
          ${params.tenantId}::uuid, ${target.branchId}::uuid,
          ${target.staffProfileId}::uuid, ${periodId}::uuid,
          ${rule.id}::uuid, ${rule.calcKind}::commission_calc_kind,
          ${rule.value}, ${rule.basis}::commission_basis,
          'payment_received'::commission_trigger,
          ${target.chargeId}::uuid, ${params.paymentId}::uuid,
          ${basisMinor}, ${amountMinor}, ${params.actorUserId}::uuid
        )
        on conflict do nothing
      `);
      written += 1;
    }
    return written;
  }

  /**
   * Bir olayın tahakkuklarını TERS KAYITLA düşer.
   *
   * Satır silinmez ve kapalı dönem değiştirilmez: ters kayıt CARİ AÇIK döneme
   * yazılır. Geçmişi değiştirmek yerine düzeltmeyi bugüne taşımak muhasebe
   * pratiğidir; kapalı bir dönemin toplamı bir daha oynamaz.
   */
  async reverse(
    tx: Tx,
    params: {
      tenantId: string;
      actorUserId: string;
      reason: string;
      chargeIds?: string[];
      paymentId?: string;
    },
  ): Promise<number> {
    const filter =
      params.paymentId !== undefined
        ? sql`a.payment_id = ${params.paymentId}::uuid`
        : sql`a.charge_id = any(${sql`array[${sql.join(
            (params.chargeIds ?? []).map((id) => sql`${id}::uuid`),
            sql`, `,
          )}]`})`;

    if (params.paymentId === undefined && (params.chargeIds ?? []).length === 0) return 0;

    const result = await tx.execute<{
      id: string;
      branch_id: string;
      staff_profile_id: string;
      rule_id: string | null;
      rule_calc_kind: CommissionCalcKind;
      rule_value: number;
      rule_basis: CommissionBasis;
      trigger_on: CommissionTrigger;
      charge_id: string | null;
      payment_id: string | null;
      basis_minor: string | number;
      amount_minor: string | number;
    }>(sql`
      select a.id, a.branch_id, a.staff_profile_id, a.rule_id, a.rule_calc_kind,
             a.rule_value, a.rule_basis, a.trigger_on, a.charge_id, a.payment_id,
             a.basis_minor, a.amount_minor
        from commission_accruals a
       where ${filter}
         and a.reverses_accrual_id is null
         -- Zaten geri alınmış tahakkuk ikinci kez ters kaydedilmez.
         --
         -- DİKKAT: burada satır kilidi (FOR UPDATE) İSTENMEZ. klinara_app bu
         -- append-only tabloda UPDATE yetkisine sahip değil ve kilit istemek
         -- 42501 verir (gözlendi). Kilide gerek de yok: bir tahakkukun en
         -- fazla bir kez ters kaydedilmesi commission_accruals_reversal_once
         -- indeksinde zaten garanti altında.
         and not exists (
           select 1 from commission_accruals r where r.reverses_accrual_id = a.id
         )
    `);

    for (const row of result.rows) {
      const periodId = await CommissionAccrualService.openPeriod(
        tx,
        params.tenantId,
        row.branch_id,
      );

      await tx.execute(sql`
        insert into commission_accruals (
          tenant_id, branch_id, staff_profile_id, period_id,
          rule_id, rule_calc_kind, rule_value, rule_basis, trigger_on,
          charge_id, payment_id, basis_minor, amount_minor,
          reverses_accrual_id, reason, actor_user_id
        ) values (
          ${params.tenantId}::uuid, ${row.branch_id}::uuid,
          ${row.staff_profile_id}::uuid, ${periodId}::uuid,
          ${row.rule_id}::uuid, ${row.rule_calc_kind}::commission_calc_kind,
          ${row.rule_value}, ${row.rule_basis}::commission_basis,
          ${row.trigger_on}::commission_trigger,
          ${row.charge_id}::uuid, ${row.payment_id}::uuid,
          ${-Number(row.basis_minor)}, ${-Number(row.amount_minor)},
          ${row.id}::uuid, ${params.reason}, ${params.actorUserId}::uuid
        )
      `);
    }
    return result.rows.length;
  }

  /**
   * Uygulanacak TEK kural.
   *
   * Sıra: personel bazlı override > genel kural, sonra en yüksek öncelik.
   * Eşitlik ihtimali modelden `commission_rules_resolution_key` kısmi tekil
   * indeksiyle kaldırıldı; `limit 1` bu yüzden keyfi bir seçim değil, tek
   * adayın alınmasıdır.
   */
  private static async resolveRule(
    tx: Tx,
    target: AccrualTarget,
    triggerOn: CommissionTrigger,
  ): Promise<ResolvedRule | undefined> {
    const result = await tx.execute<{
      id: string;
      calc_kind: CommissionCalcKind;
      value: number;
      basis: CommissionBasis;
      trigger_on: CommissionTrigger;
    }>(sql`
      select id, calc_kind, value, basis, trigger_on
        from commission_rules
       where deleted_at is null
         and is_active
         and trigger_on = ${triggerOn}::commission_trigger
         and (effective_from is null or effective_from <= current_date)
         and (effective_to is null or effective_to >= current_date)
         and (staff_profile_id is null
              or staff_profile_id = ${target.staffProfileId}::uuid)
         and (scope = 'global'
              or (scope = ${target.scope}::commission_scope
                  and scope_ref_id = ${target.scopeRefId}::uuid))
       order by (staff_profile_id is not null) desc,
                (scope <> 'global') desc,
                priority desc,
                id
       limit 1
    `);

    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      id: row.id,
      calcKind: row.calc_kind,
      value: row.value,
      basis: row.basis,
      triggerOn: row.trigger_on,
    };
  }

  /** Yüzde primi baz puandan, sabit prim doğrudan. Tek yuvarlama noktası. */
  private static compute(rule: ResolvedRule, basisMinor: number): number {
    if (rule.calcKind === 'fixed') return rule.value;
    return roundHalfEven(basisMinor * rule.value, 10000);
  }

  /**
   * Şubenin AÇIK dönemi; yoksa içinde bulunulan ayı kapsayan bir dönem açar.
   *
   * Dönemleri elle açmayı zorunlu kılmak, kural yazıldığı gün primin sessizce
   * kaybolması demekti. `on conflict do nothing` iki eş zamanlı tahakkukun
   * aynı dönemi iki kez açmasını engeller.
   */
  private static async openPeriod(
    tx: Tx,
    tenantId: string,
    branchId: string,
  ): Promise<string> {
    const existing = await tx.execute<{ id: string }>(sql`
      select id from commission_periods
       where branch_id = ${branchId}::uuid
         and status = 'open'
         and current_date between starts_on and ends_on
       order by starts_on desc
       limit 1
    `);
    const found = existing.rows[0]?.id;
    if (found !== undefined) return found;

    await tx.execute(sql`
      insert into commission_periods (tenant_id, branch_id, starts_on, ends_on)
      values (
        ${tenantId}::uuid, ${branchId}::uuid,
        date_trunc('month', current_date)::date,
        (date_trunc('month', current_date) + interval '1 month - 1 day')::date
      )
      on conflict (tenant_id, branch_id, starts_on) do nothing
    `);

    const created = await tx.execute<{ id: string }>(sql`
      select id from commission_periods
       where branch_id = ${branchId}::uuid
         and starts_on = date_trunc('month', current_date)::date
    `);
    const id = created.rows[0]?.id;
    if (id === undefined) throw new Error('Prim dönemi açılamadı');
    return id;
  }

  /** Randevunun ücret kalemleri + hangi personelin yaptığı. */
  private static async appointmentTargets(
    tx: Tx,
    appointmentId: string,
  ): Promise<AccrualTarget[]> {
    const result = await tx.execute<{
      charge_id: string;
      branch_id: string;
      staff_profile_id: string;
      service_id: string;
      service_price_minor: string | number;
      net_minor: string | number;
    }>(sql`
      select c.id             as charge_id,
             c.branch_id,
             s.staff_profile_id,
             s.service_id,
             s.price_minor    as service_price_minor,
             c.total_minor    as net_minor
        from charges c
        join appointment_services s on s.id = c.appointment_service_id
       where s.appointment_id = ${appointmentId}::uuid
         and c.status = 'open'
    `);

    return result.rows.map((row) => ({
      chargeId: row.charge_id,
      branchId: row.branch_id,
      staffProfileId: row.staff_profile_id,
      scope: 'service' as const,
      scopeRefId: row.service_id,
      servicePriceMinor: Number(row.service_price_minor),
      netAfterDiscountMinor: Number(row.net_minor),
    }));
  }

  /** Tahsilatın dağıtıldığı kalemler — yalnız personele bağlanabilenler. */
  private static async paymentTargets(
    tx: Tx,
    paymentId: string,
  ): Promise<{ target: AccrualTarget; allocatedMinor: number }[]> {
    const result = await tx.execute<{
      charge_id: string;
      branch_id: string;
      staff_profile_id: string;
      service_id: string;
      service_price_minor: string | number;
      net_minor: string | number;
      allocated_minor: string | number;
    }>(sql`
      select c.id             as charge_id,
             c.branch_id,
             s.staff_profile_id,
             s.service_id,
             s.price_minor    as service_price_minor,
             c.total_minor    as net_minor,
             a.amount_minor   as allocated_minor
        from payment_allocations a
        join charges c              on c.id = a.charge_id
        join appointment_services s on s.id = c.appointment_service_id
       where a.payment_id = ${paymentId}::uuid
         and c.status = 'open'
    `);

    return result.rows.map((row) => ({
      target: {
        chargeId: row.charge_id,
        branchId: row.branch_id,
        staffProfileId: row.staff_profile_id,
        scope: 'service' as const,
        scopeRefId: row.service_id,
        servicePriceMinor: Number(row.service_price_minor),
        netAfterDiscountMinor: Number(row.net_minor),
      },
      allocatedMinor: Number(row.allocated_minor),
    }));
  }
}
