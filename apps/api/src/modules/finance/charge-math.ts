import { splitVatInclusive } from '../../common/money';

export interface ChargeLineInput {
  quantity: number;
  /** KDV DAHİL birim fiyat. */
  unitPriceMinor: number;
  vatRateBasisPoints: number;
}

export interface ChargeAmounts {
  totalMinor: number;
  netMinor: number;
  vatMinor: number;
}

/**
 * Bir ücret kaleminin tutarlarını hesaplar: önce satır toplamı, sonra KDV
 * ayrıştırması (fiyat KDV dahil — `net = brüt - KDV`).
 *
 * Aynı aritmetik `charges` tablosunun check constraint'lerinde de yazılıdır.
 * Kopya kasıtlı: burada hesaplanır, orada KANITLANIR.
 */
export function computeChargeAmounts(input: ChargeLineInput): ChargeAmounts {
  const totalMinor = input.unitPriceMinor * input.quantity;
  const { netMinor, vatMinor } = splitVatInclusive(totalMinor, input.vatRateBasisPoints);
  return { totalMinor, netMinor, vatMinor };
}

/**
 * İade kaleminin tutarları — tutar zaten NEGATİF gelir.
 *
 * `computeChargeAmounts` kullanılamaz: iadede tutar Faz 5'in
 * `remainingValueMinor` hesabından gelir ve tek yapılacak iş KDV'yi ayırmaktır.
 */
export function computeRefundAmounts(
  refundTotalMinor: number,
  vatRateBasisPoints: number,
): ChargeAmounts {
  const totalMinor = -Math.abs(refundTotalMinor);
  const { netMinor, vatMinor } = splitVatInclusive(totalMinor, vatRateBasisPoints);
  return { totalMinor, netMinor, vatMinor };
}
