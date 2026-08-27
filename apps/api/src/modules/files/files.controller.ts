import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import { FilesService, type AccessMeta } from './files.service';
import {
  ConfirmFileDto,
  CreateFileGroupDto,
  CustomerFileListResponseDto,
  CustomerFileResponseDto,
  DownloadUrlResponseDto,
  FileGroupListResponseDto,
  FileGroupResponseDto,
  PresignUploadDto,
  PresignUploadResponseDto,
} from './dto/file.dto';

function accessMeta(request: Request): AccessMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : undefined,
  };
}

@ApiTags('customer-files')
@ApiBearerAuth('bearerAuth')
@Controller()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('uploads/presign')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'İmzalı yükleme adresi',
    description:
      'İstemci dönen adrese doğrudan PUT eder; dosya içeriği API sürecinden GEÇMEZ. Ardından `POST /customers/:id/files` ile ilişkilendirilir.',
  })
  @ApiOkResponse({ type: PresignUploadResponseDto })
  presign(
    @CurrentUser() principal: Principal,
    @Body() body: PresignUploadDto,
  ): Promise<PresignUploadResponseDto> {
    return this.files.presign(principal, body);
  }

  @Post('customers/:id/files')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Yüklenen dosyayı müşteriye bağla' })
  @ApiCreatedResponse({ type: CustomerFileResponseDto })
  confirm(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ConfirmFileDto,
  ): Promise<CustomerFileResponseDto> {
    return this.files.confirm(principal, id, body);
  }

  @Get('customers/:id/files')
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({
    summary: 'Müşteri dosyaları',
    description: 'Klinik fotoğrafları yalnız `customer.medical:read` izni olanlara döner.',
  })
  @ApiOkResponse({ type: CustomerFileListResponseDto })
  async list(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CustomerFileListResponseDto> {
    return { data: await this.files.list(principal, id) };
  }

  @Get('customers/:id/file-groups')
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({ summary: 'Öncesi/sonrası grupları ve içerdikleri dosyalar' })
  @ApiOkResponse({ type: FileGroupListResponseDto })
  async groups(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<FileGroupListResponseDto> {
    return { data: await this.files.groups(principal, id) };
  }

  @Post('customers/:id/file-groups')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Öncesi/sonrası grubu oluştur' })
  @ApiCreatedResponse({ type: FileGroupResponseDto })
  createGroup(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateFileGroupDto,
  ): Promise<FileGroupResponseDto> {
    return this.files.createGroup(id, body);
  }

  @Get('files/:id/download-url')
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({
    summary: 'Süreli indirme adresi',
    description: 'HER çağrı `customer_record_access_log`a düşer (KVKK m.6).',
  })
  @ApiOkResponse({ type: DownloadUrlResponseDto })
  downloadUrl(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: Request,
  ): Promise<DownloadUrlResponseDto> {
    return this.files.downloadUrl(principal, id, accessMeta(request));
  }

  @Delete('files/:id')
  @RequirePermission(PERMISSIONS.CUSTOMER_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Dosyayı arşivle (soft delete)' })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.files.remove(principal, id);
  }
}
