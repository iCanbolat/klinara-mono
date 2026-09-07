import type { AppointmentServiceInput } from '@klinara/shared';
import { newIdempotencyKey } from '@/lib/api/idempotency';

/**
 * Randevu oluşturma formunun saf durum makinesi.
 *
 * `apps/web-booking/src/components/booking/machine.ts`in panele uyarlanmış
 * hâli. Farklar ve gerekçeleri:
 *
 *  - **Hold, OTP ve onam adımı YOK.** Bunlar public akışın kimlik ve rıza
 *    problemleri; panelde kullanıcı zaten kimliği doğrulanmış ve müşteri
 *    telefonun sahibi olduğunu kanıtlamak zorunda değil.
 *  - **Personel seçimi HER ZAMAN açık.** `showStaffSelection` bir RANDEVU
 *    SAYFASI ayarı; panelde resepsiyon hangi personelin yapacağını bilmek
 *    zorunda ve sunucu da `services[].staffProfileId` istiyor.
 *  - **Şube üstteki seçiciden geliyor**, formun bir adımı değil.
 *
 * Saf tutuluyor (React yok, ağ yok) çünkü buradaki asıl risk bir ağ hatası
 * değil, AŞAĞI AKIŞIN SIFIRLANMAMASI: hizmet değiştirilince eski personel ve
 * eski slot formda kalırsa, kullanıcı bambaşka bir randevu oluşturur.
 */

export interface ServiceRow {
  serviceId: string | null;
  staffProfileId: string | null;
}

export interface FormState {
  customerId: string | null;
  rows: ServiceRow[];
  /** Seçilen slotun başlangıcı (offsetli ISO). */
  startsAt: string | null;
  notes: string;
  /**
   * `Idempotency-Key`.
   *
   * Sunucunun `IdempotencyService`i GÖVDEYİ de hash'liyor: aynı anahtarla
   * FARKLI gövde `IDEMPOTENCY_CONFLICT` verir. Dolayısıyla anahtar, gövdeyi
   * değiştiren her adımda yenilenmeli — aksi hâlde kullanıcı hizmeti
   * değiştirip tekrar gönderdiğinde 409 yerdi.
   */
  idempotencyKey: string;
}

export function initialState(): FormState {
  return {
    customerId: null,
    rows: [{ serviceId: null, staffProfileId: null }],
    startsAt: null,
    notes: '',
    idempotencyKey: newIdempotencyKey(),
  };
}

export type FormAction =
  | { type: 'customer'; customerId: string | null }
  | { type: 'service'; index: number; serviceId: string | null }
  | { type: 'staff'; index: number; staffProfileId: string | null }
  | { type: 'addRow' }
  | { type: 'removeRow'; index: number }
  | { type: 'slot'; startsAt: string | null }
  | { type: 'notes'; notes: string }
  | { type: 'reset' };

/**
 * Slot seçimi, kendisinden ÖNCEKİ her değişiklikte düşer.
 *
 * Uygunluk hizmet ve personele göre hesaplanıyor; biri değişince eldeki slot
 * artık o uygunluğun ürünü değil. Formda bırakmak, sunucunun hiç onaylamadığı
 * bir saati göndermek demek — ve sonucu `SLOT_CONFLICT` ya da
 * `OUTSIDE_WORKING_HOURS` olurdu.
 */
function invalidateSlot(state: FormState): FormState {
  return { ...state, startsAt: null, idempotencyKey: newIdempotencyKey() };
}

export function reduce(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'customer':
      // Müşteri uygunluğu etkilemez ama GÖVDEYİ değiştirir; anahtar yenilenir.
      return { ...state, customerId: action.customerId, idempotencyKey: newIdempotencyKey() };

    case 'service': {
      const rows = state.rows.map((row, index) =>
        index === action.index
          ? // Hizmet değişince PERSONEL de sıfırlanıyor: eski personel yeni
            // hizmete yetkin olmayabilir ve sunucu bunu reddeder.
            { serviceId: action.serviceId, staffProfileId: null }
          : row,
      );
      return invalidateSlot({ ...state, rows });
    }

    case 'staff': {
      const rows = state.rows.map((row, index) =>
        index === action.index ? { ...row, staffProfileId: action.staffProfileId } : row,
      );
      return invalidateSlot({ ...state, rows });
    }

    case 'addRow':
      return invalidateSlot({
        ...state,
        rows: [...state.rows, { serviceId: null, staffProfileId: null }],
      });

    case 'removeRow': {
      const rows = state.rows.filter((_, index) => index !== action.index);
      // Son satır silinemez: hizmetsiz randevu diye bir şey yok ve boş bir
      // form kullanıcıya ne yapacağını söylemez.
      return invalidateSlot({
        ...state,
        rows: rows.length === 0 ? [{ serviceId: null, staffProfileId: null }] : rows,
      });
    }

    case 'slot':
      // Slot seçimi gövdeyi değiştiriyor ama anahtar YENİLENMİYOR olamaz —
      // yenilenmezse önceki slot için alınmış yanıt tekrar oynatılırdı.
      return { ...state, startsAt: action.startsAt, idempotencyKey: newIdempotencyKey() };

    case 'notes':
      // Not gövdede; anahtar yenilenmeli.
      return { ...state, notes: action.notes, idempotencyKey: newIdempotencyKey() };

    case 'reset':
      return initialState();
  }
}

/** Uygunluk sorgusu atılabilir mi: her satırda hem hizmet hem personel var mı. */
export function canQueryAvailability(state: FormState): boolean {
  return (
    state.rows.length > 0 &&
    state.rows.every((row) => row.serviceId !== null && row.staffProfileId !== null)
  );
}

/** Gönderilebilir mi. İstemci doğrulamasının TAMAMI bu — gerisi sunucunun. */
export function canSubmit(state: FormState): boolean {
  return state.customerId !== null && state.startsAt !== null && canQueryAvailability(state);
}

/**
 * `POST /appointments` gövdesi. `canSubmit` false iken `null`.
 *
 * `null` dönmesi çağıranın "gönder" düğmesini etkisiz tutmasını zorluyor;
 * kısmi bir gövde kurup sunucudan 400 beklemek yerine.
 */
export function toCreateBody(
  state: FormState,
  branchId: string,
): {
  branchId: string;
  customerId: string;
  startsAt: string;
  services: AppointmentServiceInput[];
  notes?: string;
} | null {
  if (!canSubmit(state) || state.customerId === null || state.startsAt === null) return null;

  const services = state.rows.flatMap((row): AppointmentServiceInput[] =>
    row.serviceId === null || row.staffProfileId === null
      ? []
      : [{ serviceId: row.serviceId, staffProfileId: row.staffProfileId }],
  );

  const trimmed = state.notes.trim();
  return {
    branchId,
    customerId: state.customerId,
    startsAt: state.startsAt,
    services,
    // Boş not GÖNDERİLMİYOR: `''` ile "not yok" aynı şey değil ve sunucuda
    // boş dize bir not olarak saklanırdı.
    ...(trimmed === '' ? {} : { notes: trimmed }),
  };
}
