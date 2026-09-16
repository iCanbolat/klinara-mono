/**
 * Klinik operasyonu API'sinin sözleşmesi — takvim, randevu, müşteri, katalog,
 * personel ve çalışma planı.
 *
 * `admin-api.ts` randevu SAYFASININ yönetim yüzeyini tarif ediyor (içerik,
 * tema, alan adı); bu dosya kliniğin GÜNLÜK İŞİNİ. İkisi ayrı duruyor çünkü
 * ayrı yüzeyler: biri pazarlama sayfasını düzenler ve `booking_page:*`
 * izinlerine bağlıdır, diğeri müşteri kaydına ve takvime dokunur ve bir düzine
 * ayrı izne bağlıdır.
 *
 * Tipler `apps/api/src/modules/{booking,crm,catalog,staff,scheduling}/dto/*`
 * sınıflarının aynadaki karşılığıdır. Kopya DEĞİLLER: sunucuda DTO doğrulamayı
 * da tarif eder (`class-validator`), burada aynı şekil istemcinin gördüğü
 * sözleşme olarak durur ve `apps/api/test/unit/clinic-api-contract.test.ts`
 * ikisinin ayrışmasını DERLEME ZAMANINDA yakalar.
 *
 * ⚠️ Bu paket sıfır çalışma zamanı bağımlılığı taşır.
 *
 * ---------------------------------------------------------------------------
 * SUNUCUNUN ÜÇ FARKLI ZARFI
 * ---------------------------------------------------------------------------
 * Klinik uçları üç ayrı yanıt şekli kullanıyor ve bu bir tutarsızlık; istemci
 * hangisinin nerede olduğunu bilmek zorunda. Tipler bu üçünü açıkça
 * adlandırıyor ki çağrı yerinde tahmin edilmesin:
 *
 *   `Page<T>`  — `{ data, pageInfo }`, cursor'lı (randevu listesi, müşteri
 *                listesi, zaman tüneli)
 *   `List<T>`  — `{ data }`, sayfalama yok (katalog, personel, notlar,
 *                çalışma saatleri, istisnalar)
 *   çıplak dizi — `GET /customers/search` ve `GET /customers/:id/package-*`
 *
 * Üçüncüsü için tip yok, olması da gerekmiyor: `CustomerSummary[]` zaten
 * doğru tip. Buradaki not, çağıranın `.data` beklememesi için duruyor.
 */

// ---------------------------------------------------------------------------
// Ortak zarflar
// ---------------------------------------------------------------------------

export interface PageInfo {
  nextCursor: string | null;
  hasMore: boolean;
}

/** Cursor'lı sayfa. `pageInfo.nextCursor` bir SONRAKİ isteğin `cursor`'ıdır. */
export interface Page<T> {
  data: T[];
  pageInfo: PageInfo;
}

/** Sayfalanmayan liste. Ölçek sınırı ilgili ucun kendi meselesi. */
export interface List<T> {
  data: T[];
}

// ---------------------------------------------------------------------------
// Randevu
// ---------------------------------------------------------------------------

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'arrived',
  'in_progress',
  'completed',
  'no_show',
  'cancelled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_ORIGINS = ['internal', 'online'] as const;
export type AppointmentOrigin = (typeof APPOINTMENT_ORIGINS)[number];

export interface AppointmentServiceInput {
  serviceId: string;
  staffProfileId: string;
  customerPackageItemId?: string;
}

export interface CreateAppointmentInput {
  /**
   * ⚠️ Şube GÖVDEDE gidiyor, `X-Branch-Id` başlığında değil — bu uç
   * `@RequireBranchScope()` taşımıyor. Panel yine de başlığı da gönderiyor
   * (bağlam ve log için); kapsamı belirleyen bu alan.
   */
  branchId: string;
  customerId: string;
  startsAt: string;
  services: AppointmentServiceInput[];
  notes?: string;
}

export interface UpdateAppointmentInput {
  /** Tek düzenlenebilir alan. Müşteri değiştirme bilinçli olarak kapsam dışı. */
  notes?: string | null;
}

export interface RescheduleAppointmentInput {
  startsAt: string;
  services?: AppointmentServiceInput[];
  reason?: string;
}

export interface CancelAppointmentInput {
  reason?: string;
}

export interface ChangeAppointmentStatusInput {
  status: AppointmentStatus;
  reason?: string;
}

export interface AppointmentServiceLine {
  id: string;
  serviceId: string;
  staffProfileId: string;
  sortOrder: number;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceMinor: number;
  vatRateBasisPoints: number;
  customerPackageItemId: string | null;
}

export interface Appointment {
  id: string;
  tenantId: string;
  branchId: string;
  customerId: string;
  /**
   * Sunucu bunu `string` olarak ilan ediyor (DTO'da `@ApiProperty` enum'u var
   * ama tip `string`). İstemci `AppointmentStatus`a daraltmak isterse
   * `isAppointmentStatus` ile doğrulamalı — körlemesine cast, sunucuya yeni
   * bir durum eklendiğinde sessizce yanlış dallanır.
   */
  status: string;
  startsAt: string;
  endsAt: string;
  origin: string;
  notes: string | null;
  cancellationReason: string | null;
  /** `If-Match: W/"<version>"` için. */
  version: number;
  totalMinor: number;
  createdAt: string;
  services: AppointmentServiceLine[];
}

export interface AppointmentHistoryEntry {
  id: string;
  action: string;
  actorUserId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  oldStartsAt: string | null;
  newStartsAt: string | null;
  reason: string | null;
  createdAt: string;
}

export function isAppointmentStatus(value: string): value is AppointmentStatus {
  return (APPOINTMENT_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Takvim
// ---------------------------------------------------------------------------

export interface CalendarServiceLine {
  id: string;
  serviceId: string;
  serviceName: string;
  staffProfileId: string;
  sortOrder: number;
  startsAt: string;
  endsAt: string;
  priceMinor: number;
}

export interface CalendarEntry {
  id: string;
  branchId: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  version: number;
  totalMinor: number;
  services: CalendarServiceLine[];
}

/** Saat başına randevu yoğunluğu — hafta görünümünün birincil sinyali. */
export interface DensityBucket {
  /** `YYYY-MM-DD`, ŞUBE saat diliminde. */
  localDay: string;
  localHour: number;
  appointmentCount: number;
}

export interface CalendarResponse {
  branchId: string;
  /**
   * ŞUBENİN saat dilimi. İstemci gün sınırlarını BUNDAN hesaplar,
   * `Intl.DateTimeFormat().resolvedOptions().timeZone`den değil: İstanbul
   * şubesinin takvimini Berlin'den açan yönetici İstanbul günlerini görmeli.
   */
  timezone: string;
  from: string;
  to: string;
  appointments: CalendarEntry[];
  density: DensityBucket[];
}

// ---------------------------------------------------------------------------
// Uygunluk
// ---------------------------------------------------------------------------

export interface AvailabilitySlot {
  startsAt: string;
  endsAt: string;
  /** Bu slotu yapabilecek personeller. Panelde kimlikler açıktır. */
  staffProfileIds: string[];
}

export interface AvailabilityResponse {
  branchId: string;
  timezone: string;
  slotGranularityMinutes: number;
  slots: AvailabilitySlot[];
}

// ---------------------------------------------------------------------------
// Müşteri
// ---------------------------------------------------------------------------

export const CUSTOMER_GENDERS = ['female', 'male', 'other', 'undisclosed'] as const;
export type CustomerGender = (typeof CUSTOMER_GENDERS)[number];

export const CUSTOMER_SOURCES = [
  'walk_in',
  'referral',
  'instagram',
  'google',
  'website',
  'whatsapp',
  'other',
] as const;
export type CustomerSource = (typeof CUSTOMER_SOURCES)[number];

export interface CustomerTag {
  id: string;
  name: string;
  color: string | null;
}

export interface Customer {
  id: string;
  tenantId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  gender: CustomerGender | null;
  notes: string | null;
  addressLine: string | null;
  district: string | null;
  city: string | null;
  postalCode: string | null;
  source: CustomerSource | null;
  mergedIntoCustomerId: string | null;
  tags: CustomerTag[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Not ve zaman tüneli
// ---------------------------------------------------------------------------

export const CUSTOMER_NOTE_KINDS = ['general', 'treatment', 'internal'] as const;
export type CustomerNoteKind = (typeof CUSTOMER_NOTE_KINDS)[number];

/**
 * `treatment` ve `internal` notlar `customer.medical:read` İZNİ OLMAYAN bir
 * kullanıcıya SESSİZCE dönmez — yanıtta "içerik gizlendi" diye bir bayrak
 * yoktur. İstemci bu sessizliği kırmak zorunda: ilgili sekmeyi boş göstermek,
 * "bu müşterinin tedavi notu yok" demek olur ve bu YANLIŞ BİLGİDİR.
 */
export const MEDICAL_NOTE_KINDS: readonly CustomerNoteKind[] = ['treatment', 'internal'];

export interface CustomerNote {
  id: string;
  customerId: string;
  appointmentId: string | null;
  kind: CustomerNoteKind;
  body: string;
  customerVisible: boolean;
  authorUserId: string | null;
  /**
   * İyimser kilit token'ı. `PATCH /notes/:id` `If-Match: W/"<version>"`
   * ZORUNLU tutar: başlıksız istek `428`, bayat sürüm `409 VERSION_CONFLICT`.
   *
   * ⚠️ Sürümü YALNIZ METİN değişimi artırır (`customer_notes_revision`
   * trigger'ı). `kind` ya da `customerVisible` değiştiren bir düzenleme
   * sürümü olduğu yerde bırakır; istemci ETag'i tazelemek için yanıttaki
   * `version`'ı kullanmalı.
   */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerNoteRevision {
  id: string;
  body: string;
  version: number;
  editedBy: string | null;
  editedAt: string;
}

export const TIMELINE_KINDS = [
  'appointment',
  'note',
  'consent',
  'package_sale',
  'package_ledger',
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/**
 * Zaman tüneli randevu, not, onam kabulü ve paket olaylarını içerir. TAHSİLAT
 * hâlâ YOK — defterde duruyor ama bu sorguya eklenmedi (Faz 6'dan devreden
 * madde). Ekran bu boşluğu dipnotla belirtmeli, sessizce gizlememeli.
 *
 * `consent` kolunun payload'ında metnin GÖVDESİ yoktur (`consentKind`,
 * `version`, `locale`, `textSha256`): 20k'lık bir aydınlatma metni her zaman
 * çizelgesi sayfasına binerdi. Tam kanıt `GET /consent-acceptances`ten gelir.
 *
 * Paket İKİ kola bölünür ve bu bir tercih değil, zorunluluk:
 *
 *   `package_sale`   — `customer_packages` satırı. Bir satış = BİR olay.
 *                      Payload: `definitionName`, `branchId`, `totalPriceMinor`,
 *                      `currency`, `status`, `expiresAt`, `remainingSessions`.
 *   `package_ledger` — append-only defterin `purchase` DIŞINDAKİ satırları
 *                      (tüketim, iade, devir, süre dolumu, elle düzeltme).
 *                      Payload: `entryType`, `delta`, `customerPackageId`,
 *                      `definitionName`, `serviceId`, `serviceName`,
 *                      `appointmentId`, `actorUserId`, `reason`.
 *
 * Defterdeki `purchase` satırları KALEM başınadır; tek bir `package` türü
 * olsaydı üç hizmetli bir satış zaman çizelgesine üç muhasebe kaydı olarak
 * düşerdi. Her iki kol da `package:read` iznine bağlıdır ve izin yoksa
 * sorgudan hiç çıkmaz — `kinds` filtresi bunu geri açamaz.
 */
export interface TimelineEntry {
  kind: TimelineKind;
  id: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Katalog
// ---------------------------------------------------------------------------

export interface ServiceCategory {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

/**
 * Şube bazlı override. `null` = "bu şubede farklı değil, hizmetin kendi
 * değeri geçerli" — sıfır DEĞİL.
 */
export interface BranchServiceOverride {
  id: string;
  tenantId: string;
  serviceId: string;
  branchId: string;
  durationMinutes: number | null;
  bufferBeforeMinutes: number | null;
  bufferAfterMinutes: number | null;
  priceMinor: number | null;
  vatRateBasisPoints: number | null;
  isOnlineBookable: boolean | null;
  isActive: boolean | null;
  createdAt: string;
}

export interface Service {
  id: string;
  tenantId: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceMinor: number;
  vatRateBasisPoints: number;
  calendarColor: string | null;
  isOnlineBookable: boolean;
  isActive: boolean;
  createdAt: string;
  /**
   * ⚠️ TAM DEĞİŞTİRME. `POST`/`PATCH` bu diziyi olduğu gibi yazar; eksik
   * gönderilen bir override SİLİNİR. Form her zaman mevcut tam listeyi
   * okuyup göndermeli.
   */
  branchOverrides: BranchServiceOverride[];
}

// ---------------------------------------------------------------------------
// Personel
// ---------------------------------------------------------------------------

export interface StaffServiceLink {
  id: string;
  tenantId: string;
  staffProfileId: string;
  serviceId: string;
  /** `null` = tüm şubelerde geçerli. */
  branchId: string | null;
  customDurationMinutes: number | null;
  customPriceMinor: number | null;
  isActive: boolean;
  createdAt: string;
}

export interface StaffProfile {
  id: string;
  tenantId: string;
  userId: string;
  userFullName: string;
  userEmail: string;
  primaryBranchId: string | null;
  /**
   * Aktif ŞUBE üyeliklerinin şubeleri; kiracı kapsamlı roller (owner,
   * accountant) burada görünmez. `GET staff?branchId=` süzgeci bu küme VEYA
   * `primaryBranchId` ile eşleşir.
   */
  branchIds: string[];
  title: string | null;
  specialties: string[];
  calendarColor: string | null;
  bio: string | null;
  isVisibleOnline: boolean;
  isActive: boolean;
  createdAt: string;
  /** Yetkinlik matrisi. `PUT /staff/:id/services` bunu TAM DEĞİŞTİRİR. */
  services: StaffServiceLink[];
}

// ---------------------------------------------------------------------------
// Çalışma planı
// ---------------------------------------------------------------------------

/** 0 = Pazar … 6 = Cumartesi (PostgreSQL `dow` ile aynı). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface BranchHour {
  id: string;
  tenantId: string;
  branchId: string;
  dayOfWeek: number;
  isClosed: boolean;
  /** `HH:MM` — tarih taşımaz, ŞUBENİN yerel saati. */
  openTime: string | null;
  closeTime: string | null;
  breakStartTime: string | null;
  breakEndTime: string | null;
  createdAt: string;
}

export interface BranchHours {
  branchId: string;
  /** ⚠️ `PUT` TAM DEĞİŞTİRİR: eksik gün, o günün silinmesidir. */
  entries: BranchHour[];
}

export interface StaffScheduleEntry {
  id: string;
  tenantId: string;
  staffProfileId: string;
  branchId: string;
  dayOfWeek: number;
  isOff: boolean;
  startTime: string | null;
  endTime: string | null;
  createdAt: string;
}

export interface StaffScheduleByBranch {
  staffProfileId: string;
  branchId: string;
  /** ⚠️ `PUT` TAM DEĞİŞTİRİR. */
  entries: StaffScheduleEntry[];
}

export const RECURRENCE_TYPES = ['none', 'weekly'] as const;
export type RecurrenceType = (typeof RECURRENCE_TYPES)[number];

/**
 * İzin / ek mesai istisnası.
 *
 * ⚠️ `PATCH` UCU YOK: düzenleme = kaldır + yeniden ekle. Arayüz sahte bir
 * "düzenle" düğmesi gösterip arkada sil+yarat yapmamalı — ağ hatası
 * istisnayı yok ederdi.
 */
export interface ScheduleException {
  id: string;
  tenantId: string;
  staffProfileId: string;
  branchId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  recurrenceType: RecurrenceType;
  recurrenceIntervalWeeks: number;
  recurrenceUntil: string | null;
  recurrenceWeekdays: number[];
  isActive: boolean;
  createdAt: string;
}

/**
 * Tatil / özel gün.
 *
 * `branchId: null` KİRACI GENELİ demektir ve tüm şubelerin takvimini etkiler.
 * Uygunluk motoru aynı güne hem şube hem kiracı geneli kayıt bulursa ŞUBE
 * kaydını uygular (`order by branch_id nulls last`): kiracı 1 Ocak'ı kapatır,
 * tek bir şube isterse aynı güne kendi yarım gün kaydını yazar.
 *
 * `GET /holidays?branchId=` bu yüzden şube kayıtlarıyla BİRLİKTE kiracı geneli
 * kayıtları da döndürür — takvimi etkileyen kümenin tamamı budur.
 *
 * ⚠️ Kiracı geneli kayıt YAZMAK kiracı kapsamlı bir rol ister (`owner`,
 * `accountant`); şube yöneticisinin `schedule:write` izni vardır ama kapsamı
 * kendi şubesidir ve `403 BRANCH_FORBIDDEN` alır.
 *
 * ⚠️ `PATCH` tarihi ve şubeyi DEĞİŞTİRMEZ: başka bir gün, başka bir kayıttır.
 */
export interface Holiday {
  id: string;
  tenantId: string;
  /** `null` = kiracı geneli (tüm şubeler). */
  branchId: string | null;
  /** `YYYY-MM-DD` — gün, an değil. */
  holidayDate: string;
  name: string;
  /** `false` ise `openTime`/`closeTime` dolu: yarım gün açılış. */
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
  createdAt: string;
}

export interface HolidayInput {
  branchId?: string;
  holidayDate: string;
  name: string;
  isClosed?: boolean;
  openTime?: string;
  closeTime?: string;
}

export interface UpdateHolidayInput {
  name?: string;
  isClosed?: boolean;
  openTime?: string;
  closeTime?: string;
}
