import { Body, Controller, Delete, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Principal } from '../identity/principal';
import { RegisterPushDeviceDto } from './dto/push-device.dto';
import * as repo from './push-devices.repository';

/**
 * Mobil cihazın push anahtarı — oturum başına bir cihaz.
 *
 * Kayıt OTURUMA bağlı: çıkışta ya da oturum iptalinde cihaza bildirim gitmez
 * (alıcı sorgusu iptal edilmiş oturumu eler). Uygulama yine de çıkışta
 * `DELETE` çağırır ki satır beklemesin.
 */
@ApiTags('notifications')
@ApiBearerAuth('bearerAuth')
@Controller('push-devices')
@RequirePermission(PERMISSIONS.NOTIFICATION_READ)
export class PushDevicesController {
  constructor(private readonly tx: TenantTxService) {}

  @Put('current')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bu oturumun push anahtarını kaydet ya da yenile' })
  @ApiNoContentResponse()
  async register(
    @CurrentUser() principal: Principal,
    @Body() input: RegisterPushDeviceDto,
  ): Promise<void> {
    await this.tx.run((tx) =>
      repo.register(tx, {
        sessionId: principal.sessionId,
        platform: input.platform,
        environment: input.platform === 'ios' ? (input.environment ?? 'production') : 'production',
        token: input.token,
      }),
    );
  }

  @Delete('current')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bu oturumun push kaydını sil' })
  @ApiNoContentResponse()
  async unregister(@CurrentUser() principal: Principal): Promise<void> {
    await this.tx.run((tx) => repo.removeForSession(tx, principal.sessionId));
  }
}
