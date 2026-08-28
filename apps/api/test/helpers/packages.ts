import type { NestExpressApplication } from '@nestjs/platform-express';
import { auth, http, type Tokens } from './identity';
import { branchHeader } from './clinic';

/**
 * Paket fixture'ları — Faz 5 testlerinin ortak zemini.
 *
 * Her şey GERÇEK HTTP uçlarından geçer: fixture'ı doğrudan SQL ile kurmak,
 * satış transaction'ının kendisini (snapshot + tahsis + purchase defteri) test
 * dışında bırakırdı.
 */

export interface PackageDefinitionFixture {
  id: string;
  version: number;
  items: { id: string; serviceId: string; quantity: number }[];
}

export interface CustomerPackageFixture {
  id: string;
  version: number;
  remainingSessions: number;
  totalPriceMinor: number;
  items: {
    id: string;
    serviceId: string;
    quantityTotal: number;
    remainingSessions: number;
    itemTotalMinor: number;
    outstandingMinor: number;
  }[];
}

export async function createPackageDefinition(
  app: NestExpressApplication,
  tokens: Tokens,
  input: {
    slug: string;
    name?: string;
    totalPriceMinor: number;
    validityDays?: number | null;
    isTransferable?: boolean;
    items: { serviceId: string; quantity: number }[];
  },
): Promise<PackageDefinitionFixture> {
  const response = await http(app)
    .post('/api/v1/package-definitions')
    .set(auth(tokens))
    .send({
      slug: input.slug,
      name: input.name ?? input.slug,
      totalPriceMinor: input.totalPriceMinor,
      ...(input.validityDays === undefined ? {} : { validityDays: input.validityDays }),
      ...(input.isTransferable === undefined ? {} : { isTransferable: input.isTransferable }),
      items: input.items,
    });

  if (response.status !== 201) {
    throw new Error(`Paket tanımı oluşturulamadı: ${response.status} ${response.text}`);
  }
  return response.body as PackageDefinitionFixture;
}

export async function sellPackage(
  app: NestExpressApplication,
  tokens: Tokens,
  branchId: string,
  input: { customerId: string; definitionId: string; soldAt?: string },
): Promise<CustomerPackageFixture> {
  const response = await http(app)
    .post('/api/v1/customer-packages')
    .set(auth(tokens))
    .set(branchHeader(branchId))
    .send(input);

  if (response.status !== 201) {
    throw new Error(`Paket satılamadı: ${response.status} ${response.text}`);
  }
  return response.body as CustomerPackageFixture;
}
