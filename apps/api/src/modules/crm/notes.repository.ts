import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { customerNoteRevisions, customerNotes } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';
import { definedValues, hasUpdates, type Updatable } from '../../database/updates';

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

export async function updateNote(
  tx: Tx,
  id: string,
  values: Updatable<Pick<CustomerNoteRow, 'body' | 'kind' | 'customerVisible'>>,
): Promise<CustomerNoteRow | undefined> {
  const patch = definedValues(values);
  if (!hasUpdates(patch)) return findNoteById(tx, id, true);

  const [row] = await tx
    .update(customerNotes)
    .set(patch)
    .where(and(eq(customerNotes.id, id), isNull(customerNotes.deletedAt)))
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
  cursorOccurredAt?: string | undefined;
  cursorId?: string | undefined;
}

/**
 * Randevu ve notları TEK sorguda, tek sıralamada birleştirir.
 *
 * `union all` kolları ayrı ayrı sayfalanamaz — ortak `(occurred_at, id)`
 * anahtarı üzerinde sıralanıp tek cursor'la ilerliyor. Faz 5 (paket), Faz 6
 * (tahsilat) ve Faz 7 (onam) buraya kendi kolunu ekleyecek; sözleşme her kolun
 * `kind` + `payload` döndürmesi.
 */
export async function listTimeline(tx: Tx, filters: TimelineFilters): Promise<TimelineRow[]> {
  const result = await tx.execute<TimelineRow>(sql`
    with events as (
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

      union all

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
         and (${filters.canReadMedical} or n.kind = 'general')
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
