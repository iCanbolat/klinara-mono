import { Module } from '@nestjs/common';
import { PlatformTenantsController } from './platform-tenants.controller';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';

@Module({
  controllers: [PlatformTenantsController, TenancyController],
  providers: [TenancyService],
})
export class TenancyModule {}
