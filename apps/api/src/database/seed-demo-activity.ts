import type pg from 'pg';

/**
 * Demo kiracının randevu ve ciro geçmişi — karşılama sayfası ve raporlar için.
 *
 * Bunlar olmadan grafikler ya boş ya yanıltıcı: doluluğun payı
 * `resource_bookings`ten, ciro `charges`tan okunuyor ve elle eklenmiş, işgal
 * satırı olmayan randevular takvimde görünüp raporda hiç sayılmıyordu. Burada
 * her randevu üretimdeki gibi kalemi ve işgal satırıyla birlikte doğuyor;
 * tamamlananlar tahakkukunu da taşıyor.
 *
 * Tarihler BUGÜNE GÖRE (şube saatinde): seed'i yeniden koşmak pencereyi
 * bugüne kaydırır — eksik günler eklenir, önceki koşunun sonuçlanmamış demo
 * randevuları (`DEMO_NOTE`) yeniden yazılır. Panelden açılmış gerçek
 * randevulara dokunulmuyor; onlarla çakışan demo slotu atlanıyor (`23P01`).
 */

const DEMO_NOTE = '[seed] demo randevusu';
const TIMEZONE = 'Europe/Istanbul';
const PAST_DAYS = 45;
const FUTURE_DAYS = 6;
const DEMO_CUSTOMER_PHONES = [
  '+905321112233',
  '+905324445566',
  '+905331112200',
  '+905331112201',
  '+905331112202',
  '+905331112203',
  '+905331112204',
];

export interface DemoActivityInput {
  tenantId: string;
  ownerId: string;
  merkezId: string;
  kadikoyId: string;
  /** Merkez'in uygulayıcısı. */
  staffId: string;
  /** Kadıköy'ün uygulayıcısı — aynı personel iki şubede aynı anda olamaz. */
  hiddenStaffId: string;
}

interface Slot {
  time: string;
  service: 'tum-vucut-lazer' | 'bolgesel-lazer';
}

// Merkez daha yoğun, Kadıköy daha sakin: iki şube eşit dolsaydı şube
// karşılaştırma grafiği iki özdeş çubuk çizer ve hiçbir şey söylemezdi.
// Saatler çalışma saatleri içinde ve Merkez'in 13:00–14:00 molasının dışında.
const MERKEZ_SLOTS: Slot[] = [
  { time: '09:05', service: 'tum-vucut-lazer' },
  { time: '10:30', service: 'bolgesel-lazer' },
  { time: '11:30', service: 'bolgesel-lazer' },
  { time: '14:05', service: 'tum-vucut-lazer' },
  { time: '15:30', service: 'bolgesel-lazer' },
  { time: '16:30', service: 'bolgesel-lazer' },
];
const KADIKOY_SLOTS: Slot[] = [
  { time: '09:30', service: 'bolgesel-lazer' },
  { time: '11:05', service: 'tum-vucut-lazer' },
  { time: '14:30', service: 'bolgesel-lazer' },
  { time: '16:00', service: 'bolgesel-lazer' },
];

interface ServiceRow {
  id: string;
  slug: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price_minor: string;
}

export async function seedDemoActivity(client: pg.Client, input: DemoActivityInput): Promise<void> {
  const { tenantId, ownerId } = input;

  const services = await client.query<ServiceRow>(
    `select id, slug, name, duration_minutes, buffer_before_minutes, buffer_after_minutes,
            price_minor
       from services
      where tenant_id = $1 and slug in ('tum-vucut-lazer', 'bolgesel-lazer') and deleted_at is null`,
    [tenantId],
  );
  const serviceBySlug = new Map(services.rows.map((row) => [row.slug, row]));

  // Kadıköy uygulayıcısının yetkinliği: kalem trigger'ı (`K0003`) şubede
  // yetkin olmayan personeli reddediyor.
  for (const service of services.rows) {
    await client.query(
      `insert into staff_services (tenant_id, staff_profile_id, service_id, branch_id)
       values ($1, $2, $3, $4)
       on conflict (tenant_id, staff_profile_id, service_id, branch_id) do nothing`,
      [tenantId, input.hiddenStaffId, service.id, input.kadikoyId],
    );
  }

  // Seed'in kendi müşterileri — yük testi ya da panelden eklenenler değil.
  const customers = await client.query<{ id: string }>(
    `select id from customers
      where tenant_id = $1 and deleted_at is null and phone = any($2::text[])
      order by phone`,
    [tenantId, DEMO_CUSTOMER_PHONES],
  );
  if (customers.rows.length === 0) throw new Error('Demo müşterileri bulunamadı');

  const today = await client.query<{ today: string; minutes: number }>(
    `select (now() at time zone $1)::date::text as today,
            (extract(hour from now() at time zone $1) * 60
              + extract(minute from now() at time zone $1))::int as minutes`,
    [TIMEZONE],
  );
  const todayKey = today.rows[0]?.today;
  const nowMinutes = today.rows[0]?.minutes ?? 0;
  if (todayKey === undefined) throw new Error('Bugünün tarihi okunamadı');

  await client.query('begin');
  try {
    // Randevular SİLİNEMEZ (`appointment_history` değişmez); yumuşak silme.
    // Kapsam dar: önceki koşunun henüz sonuçlanmamış demo randevuları (bugün
    // geçmişte kalmış olabilirler, yeniden doğru durumla yazılacaklar) ve
    // işgal satırı hiç olmayan sahipsiz kayıtlar. Sonuçlanmış demo randevuları
    // tahakkuklarıyla birlikte yerinde kalıyor.
    await client.query(
      `update resource_bookings rb
          set active = false
         from appointments a
        where rb.appointment_id = a.id
          and a.tenant_id = $1
          and a.deleted_at is null
          and a.notes = $2
          and a.status in ('scheduled', 'confirmed')`,
      [tenantId, DEMO_NOTE],
    );
    const removed = await client.query(
      `update appointments a
          set deleted_at = now()
        where a.tenant_id = $1
          and a.deleted_at is null
          and ((a.notes = $2 and a.status in ('scheduled', 'confirmed'))
               or (a.created_by is null
                   and not exists (select 1 from resource_bookings rb
                                    where rb.appointment_id = a.id)))`,
      [tenantId, DEMO_NOTE],
    );
    const existing = await client.query<{ key: string }>(
      `select a.branch_id || ' ' || to_char(a.starts_at at time zone $3, 'YYYY-MM-DD HH24:MI') as key
         from appointments a
        where a.tenant_id = $1 and a.deleted_at is null and a.notes = $2`,
      [tenantId, DEMO_NOTE, TIMEZONE],
    );
    const kept = new Set(existing.rows.map((row) => row.key));

    let created = 0;
    let skipped = 0;

    for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset += 1) {
      const day = addDays(todayKey, offset);
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      if (weekday === 0) continue; // Pazar kapalı.

      const plans: [string, string, Slot[]][] = [
        [input.merkezId, input.staffId, MERKEZ_SLOTS],
        [input.kadikoyId, input.hiddenStaffId, KADIKOY_SLOTS],
      ];
      // Desen takvim gününe bağlı, "bugün"e değil: yeniden koşuda aynı günün
      // aynı slotları seçilsin ki korunan kayıtlarla yenileri örtüşsün.
      const dayNumber = Date.parse(`${day}T00:00:00Z`) / 86_400_000;
      for (const [branchIndex, [branchId, staffProfileId, slots]] of plans.entries()) {
        for (const [index, slot] of slots.entries()) {
          const sequence = dayNumber * 7 + index * 3 + branchIndex;
          // Her gün birkaç slot boş: tam dolu bir takvim gerçekçi değil ve
          // doluluğu gün gün aynı sayıya sabitlerdi.
          if (sequence % 4 === 0) continue;
          if (kept.has(`${branchId} ${day} ${slot.time}`)) continue;

          const service = serviceBySlug.get(slot.service);
          if (service === undefined) continue;

          const [hour, minute] = slot.time.split(':').map(Number) as [number, number];
          const endMinutes = hour * 60 + minute + service.duration_minutes;
          const isPast = offset < 0 || (offset === 0 && endMinutes <= nowMinutes);
          const status = isPast
            ? sequence % 11 === 0
              ? 'no_show'
              : sequence % 13 === 0
                ? 'cancelled'
                : 'completed'
            : sequence % 2 === 0
              ? 'confirmed'
              : 'scheduled';
          const customerId = customers.rows[(sequence + index) % customers.rows.length]?.id;

          await client.query('savepoint demo_slot');
          try {
            await insertAppointment(client, {
              tenantId,
              ownerId,
              branchId,
              staffProfileId,
              customerId,
              service,
              day,
              time: slot.time,
              status,
              origin: sequence % 3 === 0 ? 'online' : 'internal',
            });
            await client.query('release savepoint demo_slot');
            created += 1;
          } catch (error) {
            // Panelden açılmış gerçek bir randevuyla çakışıyor: o kalır.
            if ((error as { code?: string }).code !== '23P01') throw error;
            await client.query('rollback to savepoint demo_slot');
            skipped += 1;
          }
        }
      }
    }

    await client.query('commit');
    process.stdout.write(
      `[seed] demo randevuları: ${created} yazıldı, ${skipped} çakışma atlandı, ` +
        `${removed.rowCount ?? 0} eski kayıt kaldırıldı\n`,
    );
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function insertAppointment(
  client: pg.Client,
  input: {
    tenantId: string;
    ownerId: string;
    branchId: string;
    staffProfileId: string;
    customerId: string | undefined;
    service: ServiceRow;
    day: string;
    time: string;
    status: string;
    origin: string;
  },
): Promise<void> {
  const { tenantId, service, status } = input;
  const startsAt = `(($5::date + $6::time) at time zone '${TIMEZONE}')`;
  const endsAt = `(${startsAt} + make_interval(mins => $7))`;
  // Randevu, başlangıcından birkaç gün önce alınmış görünsün; kayıt tarihi
  // gelecekte olamaz.
  const appointment = await client.query<{ id: string; starts_at: Date; ends_at: Date }>(
    `insert into appointments (tenant_id, branch_id, customer_id, status, starts_at, ends_at,
                               origin, notes, created_by, created_at,
                               cancelled_at, cancelled_by, cancellation_reason)
     values ($1, $2, $3, $4::text::appointment_status, ${startsAt}, ${endsAt},
             $8::appointment_origin, $9, $10,
             least(now(), ${startsAt} - interval '3 days'),
             case when $4::text = 'cancelled' then ${startsAt} - interval '1 day' end,
             case when $4::text = 'cancelled' then $10::uuid end,
             case when $4::text = 'cancelled' then 'Müşteri iptal etti' end)
     returning id, starts_at, ends_at`,
    [
      tenantId,
      input.branchId,
      input.customerId,
      status,
      input.day,
      input.time,
      service.duration_minutes,
      input.origin,
      DEMO_NOTE,
      input.ownerId,
    ],
  );
  const row = appointment.rows[0];
  if (row === undefined) throw new Error('Demo randevusu yazılamadı');

  const line = await client.query<{ id: string }>(
    `insert into appointment_services (tenant_id, appointment_id, service_id, staff_profile_id,
                                       sort_order, starts_at, ends_at, duration_minutes,
                                       buffer_before_minutes, buffer_after_minutes, price_minor)
     values ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      tenantId,
      row.id,
      service.id,
      input.staffProfileId,
      row.starts_at,
      row.ends_at,
      service.duration_minutes,
      service.buffer_before_minutes,
      service.buffer_after_minutes,
      service.price_minor,
    ],
  );

  // İptal ve gelmedi slotu serbest bırakır (`appointments_sync_bookings`in
  // UPDATE'te yaptığı); doğrudan o durumla doğan satır pasif yazılıyor.
  await client.query(
    `insert into resource_bookings (tenant_id, branch_id, resource_type, resource_id,
                                    source_type, appointment_id, time_range, active)
     values ($1, $2, 'staff', $3, 'appointment', $4,
             tstzrange($5::timestamptz - make_interval(mins => $7),
                       $6::timestamptz + make_interval(mins => $8), '[)'),
             $9)`,
    [
      tenantId,
      input.branchId,
      input.staffProfileId,
      row.id,
      row.starts_at,
      row.ends_at,
      service.buffer_before_minutes,
      service.buffer_after_minutes,
      status !== 'cancelled' && status !== 'no_show',
    ],
  );

  if (status !== 'completed') return;

  // Tahakkuk randevu tamamlandığında doğar; KDV fiyata dahil (%20).
  const total = Number(service.price_minor);
  const net = Math.round(total / 1.2);
  await client.query(
    `insert into charges (tenant_id, branch_id, customer_id, source, appointment_service_id,
                          description, unit_list_price_minor, unit_price_minor, total_minor,
                          net_minor, vat_minor, created_by, created_at)
     values ($1, $2, $3, 'appointment_service', $4, $5, $6, $6, $6, $7, $8, $9, $10)`,
    [
      tenantId,
      input.branchId,
      input.customerId,
      line.rows[0]?.id,
      service.name,
      total,
      net,
      total - net,
      input.ownerId,
      row.ends_at,
    ],
  );
}

function addDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
