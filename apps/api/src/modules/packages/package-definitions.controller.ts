import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { requireIfMatch, weakETag } from '../../common/http/etag';
import type { Principal } from '../identity/principal';
import { PackageDefinitionsService } from './package-definitions.service';
import {
  CreatePackageDefinitionDto,
  ListPackageDefinitionsQueryDto,
  PackageDefinitionPageDto,
  PackageDefinitionResponseDto,
  UpdatePackageDefinitionDto,
} from './dto/package-definition.dto';

@ApiTags('packages')
@ApiBearerAuth('bearerAuth')
@Controller('package-definitions')
export class PackageDefinitionsController {
  constructor(private readonly definitions: PackageDefinitionsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.PACKAGE_READ)
  @ApiOperation({ summary: 'Paket tanımları (cursor sayfalamalı)' })
  @ApiOkResponse({ type: PackageDefinitionPageDto })
  list(@Query() query: ListPackageDefinitionsQueryDto): Promise<PackageDefinitionPageDto> {
    return this.definitions.list(query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.PACKAGE_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Paket tanımı oluştur' })
  @ApiCreatedResponse({ type: PackageDefinitionResponseDto })
  async create(
    @CurrentUser() principal: Principal,
    @Body() body: CreatePackageDefinitionDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PackageDefinitionResponseDto> {
    const definition = await this.definitions.create(principal, body);
    response.setHeader('ETag', weakETag(definition.version));
    return definition;
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.PACKAGE_READ)
  @ApiOperation({ summary: 'Paket tanımı detayı' })
  @ApiOkResponse({ type: PackageDefinitionResponseDto })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PackageDefinitionResponseDto> {
    const definition = await this.definitions.get(id);
    response.setHeader('ETag', weakETag(definition.version));
    return definition;
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.PACKAGE_WRITE)
  @ApiOperation({
    summary: 'Paket tanımını güncelle',
    description:
      'Değişiklik SATILMIŞ paketleri etkilemez: satış anında alınan snapshot geçerlidir.',
  })
  @ApiHeader({ name: 'If-Match', required: true, example: 'W/"3"' })
  @ApiOkResponse({ type: PackageDefinitionResponseDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdatePackageDefinitionDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PackageDefinitionResponseDto> {
    const definition = await this.definitions.update(id, requireIfMatch(ifMatch), body);
    response.setHeader('ETag', weakETag(definition.version));
    return definition;
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.PACKAGE_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Paket tanımını emekliye ayır',
    description:
      'Satılmamışsa arşivlenir (soft delete), satılmışsa yalnız pasife alınır — satış izi kopmasın.',
  })
  @ApiHeader({ name: 'If-Match', required: true, example: 'W/"3"' })
  @ApiNoContentResponse()
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<void> {
    await this.definitions.remove(id, requireIfMatch(ifMatch));
  }
}
