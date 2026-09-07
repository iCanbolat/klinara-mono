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
   * ⚠️ `version` dönüyor ama `PATCH /notes/:id` `If-Match` İSTEMİYOR:
   * son yazan kazanır. İstemci sürümü karşılaştırıp uyarabilir; bu bir
   * uyarıdır, kilit değil. Asıl çözüm sunucuda (bkz. plan, A7).
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

export const TIMELINE_KINDS = ['appointment', 'note'] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/**
 * ⚠️ Zaman tüneli YALNIZ randevu ve not içeriyor. Paket satışı/tüketimi ve
 * tahsilat defterde duruyor ama bu sorguya eklenmedi (Faz 5'ten devreden açık
 * madde). Ekran bu boşluğu dipnotla belirtmeli, sessizce gizlememeli.
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
