import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import {
  APPOINTMENT_STATUSES,
  CUSTOMER_GENDERS,
  CUSTOMER_NOTE_KINDS,
  CUSTOMER_SOURCES,
  MEDICAL_NOTE_KINDS,
  RECURRENCE_TYPES,
  TIMELINE_KINDS,
  isAppointmentStatus,
  type Appointment,
  type AppointmentHistoryEntry,
  type AppointmentServiceLine,
  type AvailabilityResponse,
  type AvailabilitySlot,
  type BranchHour,
  type BranchHours,
  type BranchServiceOverride,
  type CalendarEntry,
  type CalendarResponse,
  type CalendarServiceLine,
  type CancelAppointmentInput,
  type ChangeAppointmentStatusInput,
  type CreateAppointmentInput,
  type Customer,
  type CustomerNote,
  type CustomerNoteRevision,
  type CustomerTag,
  type DensityBucket,
  type RescheduleAppointmentInput,
  type ScheduleException,
  type Service,
  type ServiceCategory,
  type StaffProfile,
  type StaffScheduleByBranch,
  type StaffScheduleEntry,
  type StaffServiceLink,
  type TimelineEntry,
  type UpdateAppointmentInput,
} from '@klinara/shared';
import {
  APPOINTMENT_STATUSES as DTO_APPOINTMENT_STATUSES,
  AppointmentHistoryEntryDto,
  AppointmentResponseDto,
  AppointmentServiceResponseDto,
  CancelAppointmentDto,
  ChangeAppointmentStatusDto,
  CreateAppointmentDto,
  RescheduleAppointmentDto,
  UpdateAppointmentDto,
} from '../../src/modules/booking/dto/appointment.dto';
import {
  CalendarEntryDto,
  CalendarResponseDto,
  CalendarServiceDto,
  DensityBucketDto,
} from '../../src/modules/booking/dto/calendar.dto';
import {
  AvailabilityResponseDto,
  AvailabilitySlotDto,
} from '../../src/modules/booking/dto/availability.dto';
import {
  CUSTOMER_GENDERS as DTO_CUSTOMER_GENDERS,
  CUSTOMER_SOURCES as DTO_CUSTOMER_SOURCES,
  CustomerResponseDto,
  CustomerTagResponseDto,
} from '../../src/modules/crm/dto/customer.dto';
import {
  CUSTOMER_NOTE_KINDS as DTO_NOTE_KINDS,
  CustomerNoteResponseDto,
  CustomerNoteRevisionDto,
  TIMELINE_KINDS as DTO_TIMELINE_KINDS,
  TimelineEntryDto,
} from '../../src/modules/crm/dto/note.dto';
import {
  BranchServiceOverrideResponseDto,
  ServiceCategoryResponseDto,
  ServiceResponseDto,
} from '../../src/modules/catalog/dto/catalog.dto';
import {
  StaffProfileResponseDto,
  StaffServiceResponseDto,
} from '../../src/modules/staff/dto/staff.dto';
import {
  BranchHourResponseDto,
  BranchHoursResponseDto,
  ScheduleExceptionResponseDto,
  StaffScheduleByBranchResponseDto,
  StaffScheduleResponseDto,
} from '../../src/modules/scheduling/dto/scheduling.dto';

/**
 * Klinik operasyonu API'si iki yerde temsil ediliyor: `apps/api/.../dto/*`
 * sınıfları (sunucu doğrulaması + Swagger) ve `@klinara/shared`'teki
 * `clinic-api.ts` tipleri (`apps/web-admin`'in gördüğü sözleşme).
 *
 * `admin-api-contract.test.ts` bunu randevu sayfası yüzeyi için yapıyor; bu
 * dosya aynı işi takvim, müşteri, katalog, personel ve çalışma planı için
 * yapar. Ayrışmanın bedeli burada daha ağır: randevu sayfasında kaybolan bir
 * alan bir pazarlama metnidir, burada kaybolan bir alan bir randevu saati ya
 * da bir tıbbi nottur.
 *
 * İki yarım: DERLEME ZAMANI anahtar eşitliği (bir DTO alanı shared'a
 * yazılmazsa `pnpm typecheck` kırılır) ve ÇALIŞMA ZAMANI doğrulama koşumu
 * (shared'ın ilan ettiği şeklin gerçek `ValidationPipe` boru hattından
 * geçtiğinin kanıtı).
 */

// ---------------------------------------------------------------------------
// Derleme zamanı: her DTO ↔ shared tipi çift yönlü atanabilir olmalı
// ---------------------------------------------------------------------------

/**
 * Anahtar kümesi EŞİTLİĞİ — iki yönlü. Düz atanabilirlik yalnız bir yönü
 * yakalar; DTO'ya eklenen fazladan bir alan üst küme ürettiği için sessizce
 * geçerdi — tam olarak korkulan yön.
 */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : { eksik: Exclude<keyof B, keyof A> }
  : { fazla: Exclude<keyof A, keyof B> };

// Randevu
const _keysAppointment: SameKeys<AppointmentResponseDto, Appointment> = true;
const _keysAppointmentLine: SameKeys<AppointmentServiceResponseDto, AppointmentServiceLine> = true;
const _keysHistory: SameKeys<AppointmentHistoryEntryDto, AppointmentHistoryEntry> = true;
const _keysCreate: SameKeys<CreateAppointmentDto, CreateAppointmentInput> = true;
const _keysUpdate: SameKeys<UpdateAppointmentDto, UpdateAppointmentInput> = true;
const _keysReschedule: SameKeys<RescheduleAppointmentDto, RescheduleAppointmentInput> = true;
const _keysCancel: SameKeys<CancelAppointmentDto, CancelAppointmentInput> = true;
const _keysStatus: SameKeys<ChangeAppointmentStatusDto, ChangeAppointmentStatusInput> = true;

// Takvim ve uygunluk
const _keysCalendar: SameKeys<CalendarResponseDto, CalendarResponse> = true;
const _keysCalendarEntry: SameKeys<CalendarEntryDto, CalendarEntry> = true;
const _keysCalendarLine: SameKeys<CalendarServiceDto, CalendarServiceLine> = true;
const _keysDensity: SameKeys<DensityBucketDto, DensityBucket> = true;
const _keysAvailability: SameKeys<AvailabilityResponseDto, AvailabilityResponse> = true;
const _keysSlot: SameKeys<AvailabilitySlotDto, AvailabilitySlot> = true;

// Müşteri ve not
const _keysCustomer: SameKeys<CustomerResponseDto, Customer> = true;
const _keysTag: SameKeys<CustomerTagResponseDto, CustomerTag> = true;
const _keysNote: SameKeys<CustomerNoteResponseDto, CustomerNote> = true;
const _keysNoteRevision: SameKeys<CustomerNoteRevisionDto, CustomerNoteRevision> = true;
const _keysTimeline: SameKeys<TimelineEntryDto, TimelineEntry> = true;

// Katalog, personel, plan
const _keysCategory: SameKeys<ServiceCategoryResponseDto, ServiceCategory> = true;
const _keysService: SameKeys<ServiceResponseDto, Service> = true;
const _keysOverride: SameKeys<BranchServiceOverrideResponseDto, BranchServiceOverride> = true;
const _keysStaff: SameKeys<StaffProfileResponseDto, StaffProfile> = true;
const _keysStaffService: SameKeys<StaffServiceResponseDto, StaffServiceLink> = true;
const _keysBranchHour: SameKeys<BranchHourResponseDto, BranchHour> = true;
const _keysBranchHours: SameKeys<BranchHoursResponseDto, BranchHours> = true;
const _keysStaffSchedule: SameKeys<StaffScheduleResponseDto, StaffScheduleEntry> = true;
const _keysStaffScheduleByBranch: SameKeys<
  StaffScheduleByBranchResponseDto,
  StaffScheduleByBranch
> = true;
const _keysException: SameKeys<ScheduleExceptionResponseDto, ScheduleException> = true;

/** Değer düzeyinde atanabilirlik — alan TİPLERİ de uyuşmalı, yalnız adlar değil. */
const _appointmentToShared: Appointment = new AppointmentResponseDto();
const _historyToShared: AppointmentHistoryEntry = new AppointmentHistoryEntryDto();
const _calendarToShared: CalendarResponse = new CalendarResponseDto();
const _availabilityToShared: AvailabilityResponse = new AvailabilityResponseDto();
const _customerToShared: Customer = new CustomerResponseDto();
const _noteToShared: CustomerNote = new CustomerNoteResponseDto();
const _serviceToShared: Service = new ServiceResponseDto();
const _staffToShared: StaffProfile = new StaffProfileResponseDto();
const _branchHoursToShared: BranchHours = new BranchHoursResponseDto();
const _exceptionToShared: ScheduleException = new ScheduleExceptionResponseDto();

/** shared tipi → DTO sınıfı. İstemcinin gönderdiği şekli sunucu kabul etmeli. */
const _createToDto: CreateAppointmentDto = {
  branchId: '00000000-0000-4000-8000-000000000001',
  customerId: '00000000-0000-4000-8000-000000000002',
  startsAt: '2026-09-07T10:00:00+03:00',
  services: [
    {
      serviceId: '00000000-0000-4000-8000-000000000003',
      staffProfileId: '00000000-0000-4000-8000-000000000004',
    },
  ],
} satisfies CreateAppointmentInput;
const _updateToDto: UpdateAppointmentDto = { notes: null } satisfies UpdateAppointmentInput;
const _rescheduleToDto: RescheduleAppointmentDto = {
  startsAt: '2026-09-07T11:00:00+03:00',
} satisfies RescheduleAppointmentInput;
const _statusToDto: ChangeAppointmentStatusDto = {
  status: 'confirmed',
} satisfies ChangeAppointmentStatusInput;

void [
  _keysAppointment,
  _keysAppointmentLine,
  _keysHistory,
  _keysCreate,
  _keysUpdate,
  _keysReschedule,
  _keysCancel,
  _keysStatus,
  _keysCalendar,
  _keysCalendarEntry,
  _keysCalendarLine,
  _keysDensity,
  _keysAvailability,
  _keysSlot,
  _keysCustomer,
  _keysTag,
  _keysNote,
  _keysNoteRevision,
  _keysTimeline,
  _keysCategory,
  _keysService,
  _keysOverride,
  _keysStaff,
  _keysStaffService,
  _keysBranchHour,
  _keysBranchHours,
  _keysStaffSchedule,
  _keysStaffScheduleByBranch,
  _keysException,
  _appointmentToShared,
  _historyToShared,
  _calendarToShared,
  _availabilityToShared,
  _customerToShared,
  _noteToShared,
  _serviceToShared,
  _staffToShared,
  _branchHoursToShared,
  _exceptionToShared,
  _createToDto,
  _updateToDto,
  _rescheduleToDto,
  _statusToDto,
];

// ---------------------------------------------------------------------------

/**
 * `validation-exception.factory.ts`teki `flatten` ile AYNI yolu üretir.
 *
 * Fabrikayı doğrudan çağırmak yerine yol üretimi burada tekrarlanıyor çünkü
 * iddia edilen şey fabrikanın çıktısı değil, `class-validator`ın dizi
 * elemanları için ürettiği `property` değerinin sayı olduğu — yani biçimin
 * kaynağı. Fabrika değişirse bu test yeşil kalır ama o zaman da fabrikanın
 * kendi testi kırılır.
 */
function flattenPaths(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => {
    const path = prefix === '' ? error.property : `${prefix}.${error.property}`;
    const own = Object.keys(error.constraints ?? {}).length > 0 ? [path] : [];
    const nested = error.children !== undefined ? flattenPaths(error.children, path) : [];
    return [...own, ...nested];
  });
}

describe('klinik API sözleşmesi — shared ile DTO arasında sapma yok', () => {
  it('numaralandırmalar iki tarafta AYNI', () => {
    expect([...APPOINTMENT_STATUSES]).toEqual([...DTO_APPOINTMENT_STATUSES]);
    expect([...CUSTOMER_GENDERS]).toEqual([...DTO_CUSTOMER_GENDERS]);
    expect([...CUSTOMER_SOURCES]).toEqual([...DTO_CUSTOMER_SOURCES]);
    expect([...CUSTOMER_NOTE_KINDS]).toEqual([...DTO_NOTE_KINDS]);
    expect([...TIMELINE_KINDS]).toEqual([...DTO_TIMELINE_KINDS]);
    // Yinelenme tipi DTO'da `@ApiProperty({enum})` içinde satır içi yazılı.
    expect([...RECURRENCE_TYPES]).toEqual(['none', 'weekly']);
  });

  it('tıbbi not türleri, sunucunun gizlediği türlerin TAM listesi', () => {
    // `notes.service.ts` `customer.medical:read` olmadan `treatment` ve
    // `internal` notları eliyor. İstemci hangi sekmeyi gizleyeceğini bu
    // sabitten okuyor; sunucu bir tür daha eklerse ve buraya yazılmazsa,
    // panel o türü herkese açık sanıp BOŞ bir sekme gösterirdi — yani
    // "böyle bir not yok" der. Yanlış bilgi.
    expect([...MEDICAL_NOTE_KINDS]).toEqual(['treatment', 'internal']);
    for (const kind of MEDICAL_NOTE_KINDS) {
      expect(CUSTOMER_NOTE_KINDS).toContain(kind);
    }
    // `general` tıbbi DEĞİL: `customer:read` ile görülebilir.
    expect(MEDICAL_NOTE_KINDS).not.toContain('general');
  });

  it('isAppointmentStatus sunucunun tanıdığı her durumu tanıyor', () => {
    for (const status of DTO_APPOINTMENT_STATUSES) {
      expect(isAppointmentStatus(status)).toBe(true);
    }
    expect(isAppointmentStatus('uydurma')).toBe(false);
  });

  it('shared şeklinde kurulan gövdeler GERÇEK doğrulama boru hattını geçiyor', () => {
    const create: CreateAppointmentInput = {
      branchId: '11111111-1111-4111-8111-111111111111',
      customerId: '22222222-2222-4222-8222-222222222222',
      startsAt: '2026-09-07T10:00:00+03:00',
      services: [
        {
          serviceId: '33333333-3333-4333-8333-333333333333',
          staffProfileId: '44444444-4444-4444-8444-444444444444',
        },
      ],
      notes: 'ilk seans',
    };
    expect(validateSync(plainToInstance(CreateAppointmentDto, create))).toHaveLength(0);

    const reschedule: RescheduleAppointmentInput = {
      startsAt: '2026-09-07T11:00:00+03:00',
      reason: 'müşteri talebi',
    };
    expect(validateSync(plainToInstance(RescheduleAppointmentDto, reschedule))).toHaveLength(0);

    const status: ChangeAppointmentStatusInput = { status: 'arrived' };
    expect(validateSync(plainToInstance(ChangeAppointmentStatusDto, status))).toHaveLength(0);
  });

  it('`whitelist: true` shared\'da OLMAYAN bir alanı eliyor', () => {
    // Sözleşmenin asıl bedeli burada: shared'a yazılmamış bir alan sunucuya
    // ulaşsa bile SESSİZCE düşer. Test bunu sabitliyor ki "gönderdim ama
    // olmadı" bir sürpriz olmasın.
    const instance = plainToInstance(
      CreateAppointmentDto,
      {
        branchId: '11111111-1111-4111-8111-111111111111',
        customerId: '22222222-2222-4222-8222-222222222222',
        startsAt: '2026-09-07T10:00:00+03:00',
        services: [
          {
            serviceId: '33333333-3333-4333-8333-333333333333',
            staffProfileId: '44444444-4444-4444-8444-444444444444',
          },
        ],
        uydurmaAlan: 'sunucuya ulaşmaz',
      },
      { excludeExtraneousValues: false },
    );
    const errors = validateSync(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('DİZİ İÇİ alan hatası `services.0.serviceId` biçiminde yol taşıyor', () => {
    // `apps/web-admin/src/lib/forms/field-errors.ts` sunucunun ürettiği yolu
    // OLDUĞU GİBİ form alanına anahtar yapıyor. Biçim değişirse köprü sessizce
    // boşa çalışır: kullanıcı "kaydet"e basar, hiçbir alan kırmızıya dönmez ve
    // hata yalnız genel mesajda kalır. Bu yüzden biçim burada sabitleniyor.
    const errors = validateSync(
      plainToInstance(CreateAppointmentDto, {
        branchId: '11111111-1111-4111-8111-111111111111',
        customerId: '22222222-2222-4222-8222-222222222222',
        startsAt: '2026-09-07T10:00:00+03:00',
        services: [{ serviceId: 'uuid-degil', staffProfileId: 'bu-da-degil' }],
      }),
    );

    const paths = flattenPaths(errors);
    expect(paths).toContain('services.0.serviceId');
    expect(paths).toContain('services.0.staffProfileId');
  });

  it('geçersiz durum değeri REDDEDİLİYOR', () => {
    const errors = validateSync(
      plainToInstance(ChangeAppointmentStatusDto, { status: 'yarim_kaldi' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});
