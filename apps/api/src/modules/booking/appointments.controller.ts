import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import {
  RequireAnyPermission,
  RequirePermission,
} from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { requireIfMatch, weakETag } from '../../common/http/etag';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { Principal } from '../identity/principal';
import { AppointmentsService } from './appointments.service';
import {
  AppointmentHistoryResponseDto,
  AppointmentResponseDto,
  CancelAppointmentDto,
  ChangeAppointmentStatusDto,
  CreateAppointmentDto,
  RescheduleAppointmentDto,
  UpdateAppointmentDto,
} from './dto/appointment.dto';

@ApiTags('appointments')
@ApiBearerAuth('bearerAuth')
@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.APPOINTMENT_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Randevu oluştur' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Aynı anahtarla tekrarlanan istek tek randevu üretir.',
  })
  @ApiCreatedResponse({ type: AppointmentResponseDto })
  async create(
    @CurrentUser() principal: Principal,
    @Body() body: CreateAppointmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AppointmentResponseDto> {
    const result = await this.idempotency.run(idempotencyKey, body, async () => ({
      status: HttpStatus.CREATED,
      body: await this.appointments.create(principal, body),
    }));

    response.setHeader('ETag', weakETag(result.body.version));
    return result.body;
  }

  @Get(':id')
  @RequireAnyPermission(PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.APPOINTMENT_READ_OWN)
  @ApiOperation({ summary: 'Randevu detayı' })
  @ApiOkResponse({ type: AppointmentResponseDto })
  async get(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AppointmentResponseDto> {
    const appointment = await this.appointments.get(principal, id);
    // ETag'i GET veriyor: istemci onu `If-Match` olarak geri gönderir.
    response.setHeader('ETag', weakETag(appointment.version));
    return appointment;
  }

  @Get(':id/history')
  @RequireAnyPermission(PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.APPOINTMENT_READ_OWN)
  @ApiOperation({ summary: 'Randevu geçmişi' })
  @ApiOkResponse({ type: AppointmentHistoryResponseDto })
  async history(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AppointmentHistoryResponseDto> {
    return { data: await this.appointments.history(principal, id) };
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.APPOINTMENT_WRITE)
  @ApiOperation({ summary: 'Randevu notunu güncelle' })
  @ApiHeader({ name: 'If-Match', required: true, description: 'GET yanıtındaki ETag' })
  @ApiOkResponse({ type: AppointmentResponseDto })
  async update(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateAppointmentDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AppointmentResponseDto> {
    const updated = await this.appointments.update(principal, id, requireIfMatch(ifMatch), body);
    response.setHeader('ETag', weakETag(updated.version));
    return updated;
  }

  @Post(':id/reschedule')
  @RequirePermission(PERMISSIONS.APPOINTMENT_WRITE)
  // Mevcut bir kaydı DEĞİŞTİREN eylemler; yeni kaynak yaratmadıkları için 200.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Randevuyu ertele' })
  @ApiHeader({ name: 'If-Match', required: true, description: 'GET yanıtındaki ETag' })
  @ApiOkResponse({ type: AppointmentResponseDto })
  async reschedule(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: RescheduleAppointmentDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AppointmentResponseDto> {
    const updated = await this.appointments.reschedule(
      principal,
      id,
      requireIfMatch(ifMatch),
      body,
    );
    response.setHeader('ETag', weakETag(updated.version));
    return updated;
  }

  @Post(':id/cancel')
  @RequirePermission(PERMISSIONS.APPOINTMENT_WRITE)
  // Mevcut bir kaydı DEĞİŞTİREN eylemler; yeni kaynak yaratmadıkları için 200.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Randevuyu iptal et' })
  @ApiOkResponse({ type: AppointmentResponseDto })
  cancel(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CancelAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    return this.appointments.cancel(principal, id, body);
  }

  @Post(':id/status')
  @RequirePermission(PERMISSIONS.APPOINTMENT_WRITE)
  // Mevcut bir kaydı DEĞİŞTİREN eylemler; yeni kaynak yaratmadıkları için 200.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Randevu durumunu değiştir' })
  @ApiOkResponse({ type: AppointmentResponseDto })
  setStatus(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangeAppointmentStatusDto,
  ): Promise<AppointmentResponseDto> {
    return this.appointments.setStatus(principal, id, body);
  }
}
