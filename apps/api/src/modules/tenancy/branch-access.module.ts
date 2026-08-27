import { Global, Module } from '@nestjs/common';
import { BranchAccessService } from './branch-access.service';

/**
 * Şube erişim kontrolü GLOBAL bir modüldür — uygunluk cache'iyle aynı gerekçe:
 * şube kapsamlı uçlar tek bir modülde toplanmıyor (takvim, randevu, çalışma
 * saatleri, müşteri dosyaları). Her modülün ayrı ayrı import etmesi, bir gün
 * birinin unutması ve kontrolün o uçta sessizce eksik kalması demekti.
 */
@Global()
@Module({
  providers: [BranchAccessService],
  exports: [BranchAccessService],
})
export class BranchAccessModule {}
