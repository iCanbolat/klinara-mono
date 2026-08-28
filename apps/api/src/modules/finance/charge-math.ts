import { applyDiscount, splitVatInclusive } from '../../common/money';
import type { DiscountKind } from '../../database/schema';

export interface ChargeLineInput {
  quantity: number;
  /** KDV DAHİL birim fiyat. */
  unitPriceMinor: number;
  vatRateBasisPoints: number;
  discount?: { kind: DiscountKind; value: number } | undefined;
}

export interface ChargeAmounts {
  discountMinor: number;
  totalMinor: number;
  netMinor: number;
  vatMinor: number;
}

/**
 * Bir ücret kaleminin tutarlarını hesaplar.
 *
 * Sıra ÖNEMLİ ve tek yönlüdür: önce satır toplamı, sonra indirim, en son KDV
 * ayrıştırması. Ters sırada (önce KDV, sonra indirim) indirim KDV'siz tutara
 * uygulanır ve brütten sapılır — müşteriye söylenen fiyat tutmaz.
 *
 * Aynı aritmetik `charges` tablosunun check constraint'lerinde de yazılıdır.
 * Kopya kasıtlı: burada hesaplanır, orada KANITLANIR. Uygulama bir gün yanlış
 * hesaplarsa satır hiç yazılmaz.
 */
export function computeChargeAmounts(input: ChargeLineInput): ChargeAmounts {
  const lineMinor = input.unitPriceMinor * input.quantity;
  const discountMinor =
    input.discount === undefined
      ? 0
      : applyDiscount(lineMinor, input.discount.kind, input.discount.value);

  const totalMinor = lineMinor - discountMinor;
  const { netMinor, vatMinor } = splitVatInclusive(totalMinor, input.vatRateBasisPoints);

  return { discountMinor, totalMinor, netMinor, vatMinor };
}

/**
 * İade kaleminin tutarları — tutar zaten NEGATİF gelir.
 *
 * `computeChargeAmounts` kullanılamaz: orada tutar `birim × adet − indirim`
 * eşitliğinden doğar, iadede ise tutar Faz 5'in `remainingValueMinor`
 * hesabından gelir ve tek yapılacak iş KDV'yi ayırmaktır.
 */
export function computeRefundAmounts(
  refundTotalMinor: number,
  vatRateBasisPoints: number,
): ChargeAmounts {
  const totalMinor = -Math.abs(refundTotalMinor);
  const { netMinor, vatMinor } = splitVatInclusive(totalMinor, vatRateBasisPoints);
  return { discountMinor: 0, totalMinor, netMinor, vatMinor };
}
