import { Injectable } from '@nestjs/common';
import { ERROR_CODES, PERMISSIONS } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  MAX_PAGE_SIZE,
  toPage,
  type Page,
} from '../../common/pagination';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { hasPermission, type Principal } from '../identity/principal';
import * as crmRepo from './crm.repository';
import * as repo from './notes.repository';
import type { CustomerNoteKind } from '../../database/schema/crm';
import type {
  CreateCustomerNoteDto,
  CustomerNoteResponseDto,
  CustomerNoteRevisionDto,
  TimelineEntryDto,
  TimelineKind,
  TimelineQueryDto,
  UpdateCustomerNoteDto,
} from './dto/note.dto';

@Injectable()
export class NotesService {
  constructor(private readonly tx: TenantTxService) {}

  async list(principal: Principal, customerId: string): Promise<CustomerNoteResponseDto[]> {
    const medical = NotesService.canReadMedical(principal);
    const rows = await this.tx.run(async (tx) => {
      await NotesService.assertCustomer(tx, customerId);
      return repo.listNotes(tx, customerId, medical);
    });
    return rows.map((row) => NotesService.toResponse(row));
  }

  async create(
    principal: Principal,
    customerId: string,
    input: CreateCustomerNoteDto,
  ): Promise<CustomerNoteResponseDto> {
    const kind = input.kind ?? 'general';
    NotesService.assertCanWriteKind(principal, kind);

    const row = await this.tx
      .run(async (tx) => {
        await NotesService.assertCustomer(tx, customerId);
        return repo.insertNote(tx, {
          tenantId: this.tx.tenantId,
          customerId,
          body: input.body.trim(),
          kind,
          appointmentId: input.appointmentId,
          customerVisible: input.customerVisible,
          authorUserId: principal.userId,
        });
      })
      .catch((error: unknown) => {
        throw NotesService.translate(error);
      });

    return NotesService.toResponse(row);
  }

  /**
   * Not düzenleme. Metin değişirse eski sürüm TRIGGER tarafından saklanır ve
   * `version` artar — servis bunu yazmaz, yazamaz.
   */
  async update(
    principal: Principal,
    id: string,
    input: UpdateCustomerNoteDto,
  ): Promise<CustomerNoteResponseDto> {
    const medical = NotesService.canReadMedical(principal);
    if (input.kind !== undefined) NotesService.assertCanWriteKind(principal, input.kind);

    const row = await this.tx
      .run(async (tx) => {
        const current = await repo.findNoteById(tx, id, medical);
        if (current === undefined) return undefined;
        // Klinik notu göremeyen biri onu düzenleyemez de.
        NotesService.assertCanWriteKind(principal, current.kind);

        return repo.updateNote(tx, id, {
          body: input.body?.trim(),
          kind: input.kind,
          customerVisible: input.customerVisible,
        });
      })
      .catch((error: unknown) => {
        throw NotesService.translate(error);
      });

    if (row === undefined) throw AppError.notFound('Not bulunamadı');
    return NotesService.toResponse(row);
  }

  async remove(principal: Principal, id: string): Promise<void> {
    const medical = NotesService.canReadMedical(principal);
    const deleted = await this.tx.run(async (tx) => {
      const current = await repo.findNoteById(tx, id, medical);
      if (current === undefined) return false;
      NotesService.assertCanWriteKind(principal, current.kind);
      return repo.softDeleteNote(tx, id);
    });
    if (!deleted) throw AppError.notFound('Not bulunamadı');
  }

  async revisions(principal: Principal, id: string): Promise<CustomerNoteRevisionDto[]> {
    const medical = NotesService.canReadMedical(principal);
    const rows = await this.tx.run(async (tx) => {
      const current = await repo.findNoteById(tx, id, medical);
      if (current === undefined) return undefined;
      return repo.listRevisions(tx, id);
    });
    if (rows === undefined) throw AppError.notFound('Not bulunamadı');

    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      version: row.version,
      editedBy: row.editedBy,
      editedAt: row.editedAt.toISOString(),
    }));
  }

  async timeline(
    principal: Principal,
    customerId: string,
    query: TimelineQueryDto,
  ): Promise<Page<TimelineEntryDto>> {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = decodeCursor(query.cursor);
    const medical = NotesService.canReadMedical(principal);

    const rows = await this.tx.run(async (tx) => {
      await NotesService.assertCustomer(tx, customerId);
      return repo.listTimeline(tx, {
        customerId,
        limit: limit + 1,
        canReadMedical: medical,
        cursorOccurredAt: cursor?.sortKey,
        cursorId: cursor?.id,
      });
    });

    const page = toPage(rows, limit, (row) => ({
      sortKey: new Date(row.occurred_at).toISOString(),
      id: row.id,
    }));

    return {
      data: page.data.map((row) => ({
        kind: row.kind as TimelineKind,
        id: row.id,
        occurredAt: new Date(row.occurred_at).toISOString(),
        payload: row.payload,
      })),
      pageInfo: page.pageInfo,
    };
  }

  // ---------------------------------------------------------------------------

  private static canReadMedical(principal: Principal): boolean {
    return hasPermission(principal, PERMISSIONS.CUSTOMER_MEDICAL_READ);
  }

  /**
   * Klinik notu (`treatment` / `internal`) yazmak `customer.medical:write`
   * ister. Resepsiyonun `customer:write` izni serbest notla sınırlıdır —
   * aksi hâlde göremediği bir notu yazabilirdi.
   */
  private static assertCanWriteKind(principal: Principal, kind: CustomerNoteKind): void {
    if (kind === 'general') return;
    if (!hasPermission(principal, PERMISSIONS.CUSTOMER_MEDICAL_WRITE)) {
      throw AppError.forbidden('Klinik notu yazma yetkiniz yok');
    }
  }

  private static async assertCustomer(tx: Tx, customerId: string): Promise<void> {
    const customer = await crmRepo.findCustomerById(tx, customerId);
    if (customer === undefined) throw AppError.notFound('Müşteri bulunamadı');
  }

  private static translate(error: unknown): unknown {
    if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
      return AppError.notFound('Müşteri veya randevu bulunamadı');
    }
    // Kapsam trigger'ı: FK doğrulaması RLS'i bypass eder.
    if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Müşteri ve randevu bu kiracıya ait olmalı');
    }
    return error;
  }

  private static toResponse(row: repo.CustomerNoteRow): CustomerNoteResponseDto {
    return {
      id: row.id,
      customerId: row.customerId,
      appointmentId: row.appointmentId,
      kind: row.kind,
      body: row.body,
      customerVisible: row.customerVisible,
      authorUserId: row.authorUserId,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
