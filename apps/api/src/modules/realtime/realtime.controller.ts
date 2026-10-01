import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import { REALTIME_TICKET_TTL_SECONDS, TokenService } from '../identity/token.service';

export class RealtimeTicketDto {
  @ApiProperty({ description: 'Soket açıldıktan sonra ilk mesajda gönderilir' })
  ticket: string;

  @ApiProperty({ example: REALTIME_TICKET_TTL_SECONDS, description: 'Saniye' })
  expiresIn: number;
}

/** Yayın soketinin kimlik bileti — bkz. `RealtimeGateway`. */
@ApiTags('notifications')
@ApiBearerAuth('bearerAuth')
@Controller('realtime')
@RequirePermission(PERMISSIONS.NOTIFICATION_READ)
export class RealtimeController {
  constructor(private readonly tokens: TokenService) {}

  @Post('ticket')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anlık olay soketi için kısa ömürlü bilet' })
  @ApiOkResponse({ type: RealtimeTicketDto })
  async ticket(@CurrentUser() principal: Principal): Promise<RealtimeTicketDto> {
    return {
      ticket: await this.tokens.signRealtime(principal),
      expiresIn: REALTIME_TICKET_TTL_SECONDS,
    };
  }
}
