import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { DomainsService } from './domains.service';
import { CreateDomainDto, DomainDto } from './dto/domain.dto';

@ApiTags('booking-page')
@ApiBearerAuth('bearerAuth')
@Controller('booking-page/domains')
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_READ)
  @ApiOperation({
    summary: 'Alan adları',
    description:
      'Platform subdomain’i ve özel alan adları. `dnsInstructions` yalnız doğrulanmamış özel alan adlarında dolu.',
  })
  @ApiOkResponse({ type: [DomainDto] })
  list(): Promise<DomainDto[]> {
    return this.domains.list();
  }

  @Post()
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_MANAGE)
  @ApiOperation({
    summary: 'Özel alan adı ekle',
    description:
      'Konak adı platform genelinde tekildir; alınmışsa `HOST_TAKEN` döner ve hangi hesapta olduğu SÖYLENMEZ.',
  })
  @ApiOkResponse({ type: DomainDto })
  add(@Body() body: CreateDomainDto): Promise<DomainDto> {
    return this.domains.add(body);
  }

  @Post(':id/verify')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'DNS doğrulamasını şimdi çalıştır',
    description:
      'Süpürücü zaten beş dakikada bir bakıyor; bu uç bekleme süresini kısaltır. `failed` durumu `pending`e döner.',
  })
  @ApiOkResponse({ type: DomainDto })
  verify(@Param('id', new ParseUUIDPipe()) id: string): Promise<DomainDto> {
    return this.domains.verify(id);
  }

  @Post(':id/primary')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Kanonik adresi bu yap',
    description: 'Yalnız `active` bir alan adı birincil olabilir.',
  })
  @ApiOkResponse({ type: DomainDto })
  setPrimary(@Param('id', new ParseUUIDPipe()) id: string): Promise<DomainDto> {
    return this.domains.setPrimary(id);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Özel alan adını kaldır',
    description: 'Platform subdomain’i kaldırılamaz — kliniğin kanonik adresi erişilebilir kalmalı.',
  })
  @ApiNoContentResponse()
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.domains.remove(id);
  }
}
