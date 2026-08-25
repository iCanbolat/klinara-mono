import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../lib/errors.js';
import {
  BranchResponse,
  CreateBranchBody,
  CreateTenantBody,
  TenantResponse,
  TenantSettingsResponse,
  UpdateBranchBody,
  UpdateTenantBody,
} from './schema.js';
import * as repo from './repository.js';
import { setTenantContext } from '../../db/tenant-tx.js';
import { isPgError, PG_ERROR } from '../../lib/db-errors.js';

function toTenantResponse(row: repo.TenantRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    timezone: row.timezone,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  };
}

function toBranchResponse(row: repo.BranchRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    phone: row.phone,
    address: row.address,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function tenancyRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // --- Platform yönetimi ---------------------------------------------------
  typed.post(
    '/api/v1/platform/tenants',
    {
      // Yetki kontrolü GÖVDE DOĞRULAMASINDAN ÖNCE koşar. Aksi hâlde yetkisiz
      // bir çağıran, alan bazlı doğrulama hatalarından şemayı keşfedebilirdi.
      preValidation: async (request) => {
        if (!request.ctx.isPlatformAdmin) {
          throw AppError.forbidden('Bu işlem platform yöneticisi yetkisi gerektirir');
        }
      },
      schema: {
        summary: 'Yeni kiracı (klinik) oluştur',
        description: 'Yalnız platform yöneticisi. Kiracı ile birlikte ilk şubesi de açılır.',
        tags: ['tenancy'],
        security: [{ bearerAuth: [] }],
        body: CreateTenantBody,
        response: { 201: z.object({ tenant: TenantResponse, branch: BranchResponse }) },
      },
    },
    async (request, reply) => {
      const body = request.body;

      const result = await app.platformTx(request, async (tx) => {
        const tenant = await repo.insertTenant(tx, {
          slug: body.slug,
          name: body.name,
          timezone: body.timezone,
          currency: body.currency,
        });
        // Kiracı satırı yazıldı; context'i ona daraltıyoruz. Bundan sonraki
        // yazımlar platform istisnasıyla değil, normal kiracı politikasıyla geçer.
        await setTenantContext(tx, tenant.id);
        await repo.insertDefaultSettings(tx, tenant.id);
        const branch = await repo.insertBranch(tx, {
          tenantId: tenant.id,
          slug: body.branch.slug,
          name: body.branch.name,
          timezone: body.branch.timezone ?? body.timezone,
        });
        return { tenant, branch };
      }).catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu alan adı (slug) zaten kullanımda', {
            detail: `"${body.slug}" başka bir klinik tarafından alınmış.`,
          });
        }
        throw error;
      });

      return reply.code(201).send({
        tenant: toTenantResponse(result.tenant),
        branch: toBranchResponse(result.branch),
      });
    },
  );

  // --- Kiracı --------------------------------------------------------------
  typed.get(
    '/api/v1/tenant',
    {
      schema: {
        summary: 'Geçerli kiracının bilgileri',
        tags: ['tenancy'],
        security: [{ bearerAuth: [] }],
        response: { 200: TenantResponse },
      },
    },
    async (request) => {
      const row = await app.tenantTx(request, (tx) =>
        repo.findTenantById(tx, request.ctx.tenantId as string),
      );
      if (row === undefined) throw AppError.notFound('Kiracı bulunamadı');
      return toTenantResponse(row);
    },
  );

  typed.patch(
    '/api/v1/tenant',
    {
      schema: {
        summary: 'Kiracı bilgilerini güncelle',
        tags: ['tenancy'],
        security: [{ bearerAuth: [] }],
        body: UpdateTenantBody,
        response: { 200: TenantResponse },
      },
    },
    async (request) => {
      const row = await app.tenantTx(request, (tx) =>
        repo.updateTenant(tx, request.ctx.tenantId as string, request.body),
      );
      if (row === undefined) throw AppError.notFound('Kiracı bulunamadı');
      return toTenantResponse(row);
    },
  );

  typed.get(
    '/api/v1/tenant/settings',
    {
      schema: {
        summary: 'Kiracı ayarları',
        tags: ['tenancy'],
        security: [{ bearerAuth: [] }],
        response: { 200: TenantSettingsResponse },
      },
    },
    async (request) => {
      const row = await app.tenantTx(request, (tx) =>
        repo.getSettings(tx, request.ctx.tenantId as string),
      );
      if (row === undefined) throw AppError.notFound('Kiracı ayarları bulunamadı');
      return {
        slotGranularityMinutes: row.slotGranularityMinutes,
        preventCustomerDoubleBooking: row.preventCustomerDoubleBooking,
        reminderHoursBefore: row.reminderHoursBefore,
        cancelWindowHours: row.cancelWindowHours,
      };
    },
  );

  // --- Şubeler -------------------------------------------------------------
  typed.get(
    '/api/v1/branches',
    {
      schema: {
        summary: 'Kiracının şubeleri',
        tags: ['tenancy'],
        security: [{ bearerAuth: [] }],
        response: { 200: z.object({ data: z.array(BranchResponse) }) },
      },
    },
    async (request) => {
      const rows = await app.tenantTx(request, (tx) => repo.listBranches(tx));
      return { data: rows.map(toBranchResponse) };
    },
  );

  typed.post(
    '/api/v1/branches',
    {
      schema: {
        summary: 'Yeni şube aç',
        tags: ['tenancy'],
        security: [{ bearerAuth: [] }],
        body: CreateBranchBody,
        response: { 201: BranchResponse },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const tenantId = request.ctx.tenantId as string;

      const row = await app
        .tenantTx(request, async (tx) => {
          const tenant = await repo.findTenantById(tx, tenantId);
          if (tenant === undefined) throw AppError.notFound('Kiracı bulunamadı');
          return repo.insertBranch(tx, {
            tenantId,
            slug: body.slug,
            name: body.name,
            timezone: body.timezone ?? tenant.timezone,
            phone: body.phone,
            address: body.address,
          });
        })
        .catch((error: unknown) => {
          if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
            throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu şube kodu zaten kullanımda', {
              detail: `"${body.slug}" bu klinikte başka bir şubeye ait.`,
            });
          }
          throw error;
        });

      return reply.code(201).send(toBranchResponse(row));
    },
  );

  typed.patch(
    '/api/v1/branches/:id',
    {
      schema: {
        summary: 'Şube güncelle',
        tags: ['tenancy'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.uuid() }),
        body: UpdateBranchBody,
        response: { 200: BranchResponse },
      },
    },
    async (request) => {
      const row = await app.tenantTx(request, (tx) =>
        repo.updateBranch(tx, request.params.id, request.body),
      );
      // RLS sayesinde başka kiracının şubesi de burada "bulunamadı" olur —
      // varlığını bile sızdırmaz.
      if (row === undefined) throw AppError.notFound('Şube bulunamadı');
      return toBranchResponse(row);
    },
  );
}
