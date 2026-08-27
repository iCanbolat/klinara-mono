import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import {
  RequireAnyPermission,
  RequireBranchScope,
} from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import { AvailabilityService } from './availability.service';
import { AvailabilityQueryDto, AvailabilityResponseDto } from './dto/availability.dto';

@ApiTags('availability')
@ApiBearerAuth('bearerAuth')
@Controller()
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get('availability')
  // Uygulayıcı da uygunluk sorar (kendi randevusunu açmak için); onda
  // `read.all` yoktur. Bkz. `RequireAnyPermission`.
  @RequireAnyPermission(PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.APPOINTMENT_READ_OWN)
  @RequireBranchScope()
  @ApiOperation({ summary: 'Uygun slotlar ve aday personel kümesi' })
  @ApiOkResponse({ type: AvailabilityResponseDto })
  find(
    @CurrentUser() principal: Principal,
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityResponseDto> {
    return this.availability.findSlots(principal, query);
  }
}
