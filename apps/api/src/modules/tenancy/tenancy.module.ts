import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PlatformTenantsController } from './platform-tenants.controller';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';

@Module({
  // Kiracı kurulumu işletme sahibi davetini de oluşturur; davet mantığı kimlik
  // modülünün sorumluluğudur (kiracı modülü onun repository'sine dokunmaz).
  imports: [IdentityModule],
  controllers: [PlatformTenantsController, TenancyController],
  providers: [TenancyService],
})
export class TenancyModule {}
