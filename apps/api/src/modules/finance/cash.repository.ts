import { and, asc, desc, eq, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { cashMovements, cashRegisterSessions, refunds } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';
import { definedValues, type Updatable } from '../../database/updates';

export type CashSessionRow = typeof cashRegisterSessions.$inferSelect;
export type CashMovementRow = typeof cashMovements.$inferSelect;
export type RefundRow = typeof refunds.$inferSelect;

export async function insertSession(
  tx: Tx,
  values: typeof cashRegisterSessions.$inferInsert,
): Promise<CashSessionRow> {
  const [row] = await tx.insert(cashRegisterSessions).values(values).returning();
  if (row === undefined) throw new Error('Kasa oturumu açılamadı');
  return row;
}

export async function findSessionById(
  tx: Tx,
  id: string,
): Promise<CashSessionRow | undefined> {
  const [row] = await tx
    .select()
    .from(cashRegisterSessions)
    .where(eq(cashRegisterSessions.id, id));
  return row;
}

export async function lockSessionById(
  tx: Tx,
  id: string,
): Promise<CashSessionRow | undefined> {
  const [row] = await tx
    .select()
    .from(cashRegisterSessions)
    .where(eq(cashRegisterSessions.id, id))
    .for('update');
  return row;
}

/** Şubenin açık oturumu — nakit tahsilatın bağlanacağı yer. */
export async function findOpenSession(
  tx: Tx,
  branchId: string,
): Promise<CashSessionRow | undefined> {
  const [row] = await tx
    .select()
    .from(cashRegisterSessions)
    .where(
      and(
        eq(cashRegisterSessions.branchId, branchId),
        isNull(cashRegisterSessions.closedAt),
      ),
    );
  return row;
}

export async function updateSessionWithVersion(
  tx: Tx,
  id: string,
  expectedVersion: number,
  values: Updatable<typeof cashRegisterSessions.$inferInsert>,
): Promise<CashSessionRow | undefined> {
  const [row] = await tx
    .update(cashRegisterSessions)
    .set(definedValues(values))
    .where(
      and(
        eq(cashRegisterSessions.id, id),
        eq(cashRegisterSessions.version, expectedVersion),
      ),
    )
    .returning();
  return row;
}

export async function listSessions(
  tx: Tx,
  filters: { branchId?: string | undefined; status?: 'open' | 'closed' | undefined },
  page: { limit: number; cursor?: { sortKey: string; id: string } | undefined },
): Promise<CashSessionRow[]> {
  const conditions: SQL[] = [];
  if (filters.branchId !== undefined) {
    conditions.push(eq(cashRegisterSessions.branchId, filters.branchId));
  }
  if (filters.status === 'open') conditions.push(isNull(cashRegisterSessions.closedAt));
  if (filters.status === 'closed') conditions.push(isNotNull(cashRegisterSessions.closedAt));

  if (page.cursor !== undefined) {
    const at = new Date(page.cursor.sortKey);
    const id = page.cursor.id;
    const step = or(
      lt(cashRegisterSessions.openedAt, at),
      and(eq(cashRegisterSessions.openedAt, at), lt(cashRegisterSessions.id, id)),
    );
    if (step !== undefined) conditions.push(step);
  }

  return tx
    .select()
    .from(cashRegisterSessions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(cashRegisterSessions.openedAt), desc(cashRegisterSessions.id))
    .limit(page.limit + 1);
}

export async function insertMovement(
  tx: Tx,
  values: typeof cashMovements.$inferInsert,
): Promise<CashMovementRow> {
  const [row] = await tx.insert(cashMovements).values(values).returning();
  if (row === undefined) throw new Error('Kasa hareketi yazılamadı');
  return row;
}

export async function listMovements(tx: Tx, sessionId: string): Promise<CashMovementRow[]> {
  return tx
    .select()
    .from(cashMovements)
    .where(eq(cashMovements.sessionId, sessionId))
    .orderBy(asc(cashMovements.createdAt), asc(cashMovements.id));
}

/**
 * Oturumun BEKLENEN nakdi — hareketlerin işaretli toplamı.
 *
 * Saklanan bir sayaç yok: beklenen tutar her sorulduğunda hareketlerden
 * hesaplanır. Açılış bakiyesi de bir `opening` hareketi olarak yazıldığı için
 * formül tek satırdır.
 */
export async function expectedCashMinor(tx: Tx, sessionId: string): Promise<number> {
  const result = await tx.execute<{ total: string | null }>(sql`
    select coalesce(sum(amount_minor), 0)::bigint as total
      from cash_movements where session_id = ${sessionId}::uuid
  `);
  return Number(result.rows[0]?.total ?? 0);
}

/** Oturum boyunca alınan tahsilatların yöntem kırılımı (nakit dışı dahil). */
export async function paymentsByMethod(
  tx: Tx,
  sessionId: string,
): Promise<{ method: string; amountMinor: number; count: number }[]> {
  const session = await findSessionById(tx, sessionId);
  if (session === undefined) return [];

  const result = await tx.execute<{
    method: string;
    amount_minor: string | number;
    count: string | number;
  }>(sql`
    select method,
           coalesce(sum(amount_minor), 0)::bigint as amount_minor,
           count(*)::int as count
      from payments
     where branch_id = ${session.branchId}::uuid
       and status = 'posted'
       and paid_at >= ${session.openedAt.toISOString()}::timestamptz
       and (${session.closedAt?.toISOString() ?? null}::timestamptz is null
            or paid_at <= ${session.closedAt?.toISOString() ?? null}::timestamptz)
     group by method
     order by method
  `);

  return result.rows.map((row) => ({
    method: row.method,
    amountMinor: Number(row.amount_minor),
    count: Number(row.count),
  }));
}

export async function insertRefund(
  tx: Tx,
  values: typeof refunds.$inferInsert,
): Promise<RefundRow> {
  const [row] = await tx.insert(refunds).values(values).returning();
  if (row === undefined) throw new Error('İade yazılamadı');
  return row;
}
