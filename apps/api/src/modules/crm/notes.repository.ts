import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { customerNoteRevisions, customerNotes } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';
import { definedValues, hasUpdates, type Updatable } from '../../database/updates';
import type { TimelineKind } from './dto/note.dto';

export type CustomerNoteRow = typeof customerNotes.$inferSelect;
export type CustomerNoteRevisionRow = typeof customerNoteRevisions.$inferSelect;

/**
 * Klinik notlarını (işlem/iç) YALNIZ `customer.medical:read` izni olanlar görür.
 *
 * Daraltma SQL'de yapılıyor, uygulamada değil: listeyi çektikten sonra elemek
 * sayfa boyutunu bozardı (`limit 50` iste, 12 satır al) — Faz 3'te
 * `practitioner` kısıtında alınan kararın aynısı.
 */
function visibilityFilter(canReadMedical: boolean): SQL | undefined {
  return canReadMedical ? undefined : eq(customerNotes.kind, 'general');
}

export async function listNotes(
  tx: Tx,
  customerId: string,
  canReadMedical: boolean,
): Promise<CustomerNoteRow[]> {
  return tx
    .select()
    .from(customerNotes)
    .where(
      and(
        eq(customerNotes.customerId, customerId),
        isNull(customerNotes.deletedAt),
        visibilityFilter(canReadMedical),
      ),
    )
    .orderBy(desc(customerNotes.createdAt), desc(customerNotes.id));
}

/**
 * Görünmeyen not `undefined` döner — yani çağıran `404` alır, `403` değil.
 * `403`, "bu kayıt var ama sana kapalı" bilgisini sızdırırdı.
 */
export async function findNoteById(
  tx: Tx,
  id: string,
  canReadMedical: boolean,
): Promise<CustomerNoteRow | undefined> {
  const [row] = await tx
    .select()
    .from(customerNotes)
    .where(and(eq(customerNotes.id, id), isNull(customerNotes.deletedAt), visibilityFilter(canReadMedical)))
    .limit(1);
  return row;
}

export async function insertNote(
  tx: Tx,
  values: {
    tenantId: string;
    customerId: string;
    body: string;
    kind: CustomerNoteRow['kind'];
    appointmentId?: string | undefined;
    customerVisible?: boolean | undefined;
    authorUserId: string;
  },
): Promise<CustomerNoteRow> {
  const [row] = await tx.insert(customerNotes).values(values).returning();
  if (row === undefined) throw new Error('Not oluşturulamadı');
  return row;
}

/**
 * İyimser kilit (API sözleşmesi 5.7) — `expectedVersion` tutmazsa 0 satır döner.
 *
 * DİKKAT, `version`ı YALNIZ METİN DEĞİŞİMİ artırır: `customer_notes_revision`
 * trigger'ı sürümü `new.body is distinct from old.body` koşuluyla artırıyor.
 * Yani `kind` ya da `customerVisible` değiştiren bir düzenleme sürümü olduğu
 * yerde bırakır. Bu kasıtlı: kilidin koruduğu şey notun METNİ ve onun revizyon
 * geçmişidir; bayrak değişimi kaybolan bir cümle üretmez.
 */
export async function updateNoteWithVersion(
  tx: Tx,
  id: string,
  expectedVersion: number,
  values: Updatable<Pick<CustomerNoteRow, 'body' | 'kind' | 'customerVisible'>>,
): Promise<CustomerNoteRow | undefined> {
  const patch = definedValues(values);
  // Boş yama da sürümü DOĞRULAR: "hiçbir şey değiştirme" isteği bile bayat bir
  // sürümle geldiyse istemcinin elindeki kopya yanlıştır ve 409 hak eder.
  if (!hasUpdates(patch)) {
    const current = await findNoteById(tx, id, true);
    return current?.version === expectedVersion ? current : undefined;
  }

  const [row] = await tx
    .update(customerNotes)
    .set(patch)
    .where(
      and(
        eq(customerNotes.id, id),
        eq(customerNotes.version, expectedVersion),
        isNull(customerNotes.deletedAt),
      ),
    )
    .returning();
  return row;
}

export async function softDeleteNote(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx
    .update(customerNotes)
    .set({ deletedAt: new Date() })
    .where(and(eq(customerNotes.id, id), isNull(customerNotes.deletedAt)))
    .returning({ id: customerNotes.id });
  return rows.length > 0;
}

export async function listRevisions(tx: Tx, noteId: string): Promise<CustomerNoteRevisionRow[]> {
  return tx
    .select()
    .from(customerNoteRevisions)
    .where(eq(customerNoteRevisions.noteId, noteId))
    .orderBy(desc(customerNoteRevisions.editedAt));
}

// ---------------------------------------------------------------------------
// Zaman çizelgesi
// ---------------------------------------------------------------------------

export interface TimelineRow extends Record<string, unknown> {
  kind: string;
  id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

interface TimelineFilters {
  customerId: string;
  limit: number;
  canReadMedical: boolean;
  /** `package:read` — paket kolları bu izne bağlı (bkz. `wants`). */
  canReadPackages: boolean;
  cursorOccurredAt?: string | undefined;
  cursorId?: string | undefined;
  /** Boş/verilmemişse tüm türler. */
  kinds?: readonly TimelineKind[] | undefined;
  /** Dahil. */
  from?: string | undefined;
  /** HARİÇ. */
  to?: string | undefined;
}

/**
 * Randevu, not, onam ve paket olaylarını TEK sorguda, tek sıralamada birleştirir.
 *
 * `union all` kolları ayrı ayrı sayfalanamaz — ortak `(occurred_at, id)`
 * anahtarı üzerinde sıralanıp tek cursor'la ilerliyor. Sözleşme her kolun
 * `kind` + `payload` döndürmesi. Faz 6 (tahsilat) hâlâ kendi kolunu eklemedi.
 */
export async function listTimeline(tx: Tx, filters: TimelineFilters): Promise<TimelineRow[]> {
  // Tür filtresi kolu SQL'e HİÇ SOKMUYOR, sonradan elemiyor değil: `union all`
  // her kolu tam tarayıp sonra atmak, "yalnız notları göster" diyen bir
  // istemciye randevu tablosunun bedelini ödetmek olurdu.
  const wants = (kind: TimelineKind): boolean => {
    // İzin daraltması kullanıcı tercihinden BAĞIMSIZ ve önce geliyor: tür
    // filtresi göremeyeceği bir olayı görünür kılamaz (notlardaki kuralın aynısı).
    if (!filters.canReadPackages && (kind === 'package_sale' || kind === 'package_ledger')) {
      return false;
    }
    return filters.kinds === undefined || filters.kinds.length === 0 || filters.kinds.includes(kind);
  };

  // Tarih koşulu her kolun KENDİ zaman sütununa iniyor: `occurred_at` ancak
  // birleşimden sonra var ve orada filtrelemek indeksleri kullanılmaz kılardı.
  const window = (column: SQL): SQL => sql`
       and (${filters.from ?? null}::timestamptz is null
            or ${column} >= ${filters.from ?? null}::timestamptz)
       and (${filters.to ?? null}::timestamptz is null
            or ${column} < ${filters.to ?? null}::timestamptz)`;

  const branches: SQL[] = [];

  if (wants('appointment')) {
    branches.push(sql`
      select 'appointment'::text as kind,
             a.id,
             a.starts_at as occurred_at,
             jsonb_build_object(
               'status',     a.status,
               'startsAt',   a.starts_at,
               'endsAt',     a.ends_at,
               'branchId',   a.branch_id,
               -- Tutar appointments tablosunda durmuyor; kalemlerin SNAPSHOT
               -- fiyatlarından toplanıyor (katalog zammı geçmişi bozmasın).
               'totalMinor', coalesce((
                 select sum(s.price_minor)::bigint
                   from appointment_services s
                  where s.appointment_id = a.id
               ), 0)
             ) as payload
        from appointments a
       where a.customer_id = ${filters.customerId}::uuid
         and a.deleted_at is null
         ${window(sql`a.starts_at`)}`);
  }

  if (wants('note')) {
    branches.push(sql`
      select 'note'::text as kind,
             n.id,
             n.created_at as occurred_at,
             jsonb_build_object(
               'kind',            n.kind,
               'body',            n.body,
               'appointmentId',   n.appointment_id,
               'authorUserId',    n.author_user_id,
               'customerVisible', n.customer_visible
             ) as payload
        from customer_notes n
       where n.customer_id = ${filters.customerId}::uuid
         and n.deleted_at is null
         -- İzin daraltması kullanıcı tercihinden BAĞIMSIZ: tür filtresi
         -- göremediği bir notu görünür kılamaz.
         and (${filters.canReadMedical} or n.kind = 'general')
         ${window(sql`n.created_at`)}`);
  }

  if (wants('consent')) {
    // Onam kabulü (Faz 7). Metnin GÖVDESİ payload'a KONMUYOR: 20k'lık bir
    // aydınlatma metni her zaman çizelgesi sayfasına binerdi. Kanıtın tamamı
    // GET /consent-acceptances?customerId= ucundan çekiliyor.
    branches.push(sql`
      select 'consent'::text as kind,
             c.id,
             c.accepted_at as occurred_at,
             jsonb_build_object(
               'consentKind', c.kind,
               'version',     c.consent_version,
               'locale',      c.locale,
               'textSha256',  c.text_sha256
             ) as payload
        from booking_consent_acceptances c
       where c.customer_id = ${filters.customerId}::uuid
         ${window(sql`c.accepted_at`)}`);
  }

  if (wants('package_sale')) {
    // Satış PAKETTEN okunuyor, defterden değil. Defterdeki `purchase` satırları
    // KALEM başınadır: üç hizmetli bir paket satışı zaman çizelgesine üç olay
    // olarak düşerdi ve "bugün ne oldu" sorusunun cevabı bir satış yerine üç
    // muhasebe kaydı olurdu.
    branches.push(sql`
      select 'package_sale'::text as kind,
             p.id,
             p.sold_at as occurred_at,
             jsonb_build_object(
               'definitionName',    p.definition_name,
               'branchId',          p.branch_id,
               'totalPriceMinor',   p.total_price_minor,
               'currency',          p.currency,
               'status',            p.status,
               'expiresAt',         p.expires_at,
               'remainingSessions', p.remaining_sessions
             ) as payload
        from customer_packages p
       where p.customer_id = ${filters.customerId}::uuid
         and p.deleted_at is null
         ${window(sql`p.sold_at`)}`);
  }

  if (wants('package_ledger')) {
    // Satın alma DIŞINDAKİ defter hareketleri: tüketim, iade, devir, süre
    // dolumu, elle düzeltme. `purchase` yukarıdaki kolda temsil edildiği için
    // burada elenmese olay iki kez görünürdü.
    //
    // Defterde `customer_id` YOK; müşteriye paketten geçiliyor. Sıra önemli:
    // `customer_packages_customer_idx` müşterinin paketlerini,
    // `package_ledger_package_idx` her paketin hareketlerini veriyor.
    branches.push(sql`
      select 'package_ledger'::text as kind,
             e.id,
             e.created_at as occurred_at,
             jsonb_build_object(
               'entryType',         e.entry_type,
               'delta',             e.delta,
               'customerPackageId', e.customer_package_id,
               'definitionName',    p.definition_name,
               'serviceId',         i.service_id,
               'serviceName',       i.service_name,
               'appointmentId',     e.appointment_id,
               'actorUserId',       e.actor_user_id,
               'reason',            e.reason
             ) as payload
        from package_ledger_entries e
        join customer_packages p on p.id = e.customer_package_id
        join customer_package_items i on i.id = e.customer_package_item_id
       where p.customer_id = ${filters.customerId}::uuid
         and p.deleted_at is null
         and e.entry_type <> 'purchase'
         ${window(sql`e.created_at`)}`);
  }

  // Her tür elenmişse sorgu hiç atılmıyor: sıfır kollu bir `union all`
  // geçersiz SQL, boş sonuç ise zaten bildiğimiz cevap.
  if (branches.length === 0) return [];

  const result = await tx.execute<TimelineRow>(sql`
    with events as (
      ${sql.join(branches, sql` union all `)}
    )
    select kind, id::text, occurred_at, payload
      from events
     where (${filters.cursorOccurredAt ?? null}::timestamptz is null
            or (occurred_at, id)
               < (${filters.cursorOccurredAt ?? null}::timestamptz, ${filters.cursorId ?? null}::uuid))
     order by occurred_at desc, id desc
     limit ${filters.limit}
  `);
  return result.rows;
}
