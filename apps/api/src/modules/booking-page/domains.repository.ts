import { and, eq, sql } from 'drizzle-orm';
import { bookingSiteDomains, type DomainVerificationStatus } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type BookingSiteDomainRow = typeof bookingSiteDomains.$inferSelect;

export async function listDomains(tx: Tx, siteId: string): Promise<BookingSiteDomainRow[]> {
  return tx
    .select()
    .from(bookingSiteDomains)
    .where(eq(bookingSiteDomains.bookingSiteId, siteId))
    .orderBy(bookingSiteDomains.kind, bookingSiteDomains.host);
}

export async function findDomain(
  tx: Tx,
  siteId: string,
  domainId: string,
): Promise<BookingSiteDomainRow | undefined> {
  const [row] = await tx
    .select()
    .from(bookingSiteDomains)
    .where(
      and(eq(bookingSiteDomains.bookingSiteId, siteId), eq(bookingSiteDomains.id, domainId)),
    )
    .limit(1);
  return row;
}

export async function insertDomain(
  tx: Tx,
  values: {
    tenantId: string;
    bookingSiteId: string;
    host: string;
    kind: 'platform_subdomain' | 'custom';
    verificationStatus?: DomainVerificationStatus;
    verificationToken: string;
    dnsTarget: string;
    isPrimary?: boolean;
  },
): Promise<BookingSiteDomainRow> {
  const [row] = await tx.insert(bookingSiteDomains).values(values).returning();
  if (row === undefined) throw new Error('Alan adı yazılamadı');
  return row;
}

export async function updateDomain(
  tx: Tx,
  domainId: string,
  patch: Partial<{
    verificationStatus: DomainVerificationStatus;
    checkAttempts: number;
    lastCheckedAt: Date | null;
    verifiedAt: Date | null;
    activatedAt: Date | null;
    failureReason: string | null;
    isPrimary: boolean;
  }>,
): Promise<BookingSiteDomainRow | undefined> {
  const [row] = await tx
    .update(bookingSiteDomains)
    .set(patch)
    .where(eq(bookingSiteDomains.id, domainId))
    .returning();
  return row;
}

export async function deleteDomain(tx: Tx, domainId: string): Promise<void> {
  await tx.delete(bookingSiteDomains).where(eq(bookingSiteDomains.id, domainId));
}

/**
 * Birincil host'u tek satıra indirger.
 *
 * `booking_site_domains_primary_key` kısmi UNIQUE indeksi site başına tek
 * `is_primary` satırına izin veriyor; bu yüzden yeni birincili yazmadan ÖNCE
 * eskisi düşürülmek zorunda — sıra bir üslup tercihi değil, indeksin şartı.
 */
export async function clearPrimary(tx: Tx, siteId: string): Promise<void> {
  await tx
    .update(bookingSiteDomains)
    .set({ isPrimary: false })
    .where(
      and(eq(bookingSiteDomains.bookingSiteId, siteId), eq(bookingSiteDomains.isPrimary, true)),
    );
}

/** Doğrulama süpürücüsünün taradığı küme: terminal olmayan alan adları. */
export async function listPendingDomains(tx: Tx): Promise<BookingSiteDomainRow[]> {
  return tx
    .select()
    .from(bookingSiteDomains)
    .where(
      sql`${bookingSiteDomains.verificationStatus} in ('pending', 'dns_verified')
          and ${bookingSiteDomains.kind} = 'custom'`,
    );
}

/** Doğrulanacak alan adı olan kiracılar (süpürücünün birinci adımı). */
export async function listTenantsWithPendingDomains(tx: Tx): Promise<string[]> {
  const result = await tx.execute<{ tenant_id: string }>(sql`
    select distinct tenant_id
      from booking_site_domains
     where kind = 'custom'
       and verification_status in ('pending', 'dns_verified')
  `);
  return result.rows.map((row) => row.tenant_id);
}
