import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission, SelfService } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import type { Principal } from './principal';
import { MeResponseDto, UpdateUserDto, UserListResponseDto, UserResponseDto } from './dto/user.dto';

@ApiTags('identity')
@ApiBearerAuth('bearerAuth')
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @SelfService()
  @ApiOperation({
    summary: 'Oturumdaki kullanıcı, rolleri ve izinleri',
    description: 'İstemci menüsünü buna göre kurar; yetki kontrolü yine sunucudadır.',
  })
  @ApiOkResponse({ type: MeResponseDto })
  me(@CurrentUser() principal: Principal): Promise<MeResponseDto> {
    return this.users.me(principal);
  }

  @Patch('me')
  @SelfService()
  @ApiOperation({ summary: 'Kendi profilini güncelle' })
  @ApiOkResponse({ type: UserResponseDto })
  updateMe(
    @CurrentUser() principal: Principal,
    @Body() body: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.users.updateMe(principal, body);
  }

  @Get('users')
  @RequirePermission(PERMISSIONS.USER_READ)
  @ApiOperation({ summary: 'Kliniğin personeli' })
  @ApiOkResponse({ type: UserListResponseDto })
  async list(): Promise<UserListResponseDto> {
    return { data: await this.users.list() };
  }

  @Get('users/:id')
  @RequirePermission(PERMISSIONS.USER_READ)
  @ApiOperation({ summary: 'Personel ayrıntısı (üyelikleriyle)' })
  @ApiOkResponse({ type: UserResponseDto })
  get(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<UserResponseDto> {
    return this.users.get(id, principal.tenantId);
  }

  @Patch('users/:id')
  @RequirePermission(PERMISSIONS.USER_WRITE)
  @ApiOperation({ summary: 'Personel bilgisi güncelle / hesabı devre dışı bırak' })
  @ApiOkResponse({ type: UserResponseDto })
  update(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.users.update(id, principal.tenantId, body);
  }
}
