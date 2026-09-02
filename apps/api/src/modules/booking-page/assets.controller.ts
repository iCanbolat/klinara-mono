import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import type { TenantAssetPurpose } from '../../database/schema';
import { AssetsService } from './assets.service';
import {
  AssetDto,
  ConfirmAssetDto,
  PresignAssetDto,
  PresignAssetResponseDto,
} from './dto/asset.dto';

@ApiTags('booking-page')
@ApiBearerAuth('bearerAuth')
@Controller('booking-page/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_READ)
  @ApiOperation({ summary: 'Sayfa görselleri' })
  @ApiOkResponse({ type: [AssetDto] })
  list(@Query('purpose') purpose?: TenantAssetPurpose): Promise<AssetDto[]> {
    return this.assets.list(purpose);
  }

  @Post('presign')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_MANAGE)
  @ApiOperation({
    summary: 'Yükleme adresi al',
    description: 'Veritabanına hiçbir şey yazmaz; kayıt `confirm` adımında açılır.',
  })
  @ApiOkResponse({ type: PresignAssetResponseDto })
  presign(@Body() body: PresignAssetDto): Promise<PresignAssetResponseDto> {
    return this.assets.presign(body);
  }

  @Post('confirm')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_MANAGE)
  @ApiOperation({
    summary: 'Yüklemeyi doğrula ve kaydet',
    description: 'Boyut ve tip sunucuda `HeadObject` ile okunur; istemcinin beyanı esas alınmaz.',
  })
  @ApiOkResponse({ type: AssetDto })
  confirm(@Body() body: ConfirmAssetDto): Promise<AssetDto> {
    return this.assets.confirm(body);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.BOOKING_PAGE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Görseli kaldır',
    description: 'Yumuşak silme — eski içerik sürümleri bu kimliği anmaya devam ediyor.',
  })
  @ApiNoContentResponse()
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.assets.remove(id);
  }
}
