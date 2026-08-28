import { Module } from '@nestjs/common';
import { CashController } from './cash.controller';
import { CashSessionsService } from './cash-sessions.service';
import { ChargeGenerationService } from './charge-generation.service';
import { CommissionAccrualService } from './commission-accrual.service';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';
import { ChargesController } from './charges.controller';
import { ChargesService } from './charges.service';
import { DiscountsController } from './discounts.controller';
import { DiscountsService } from './discounts.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';

/**
 * Finans modülü.
 *
 * `ChargeGenerationService` DIŞARIYA açılır: randevu ve paket akışları borcu
 * KENDİ transaction'larında doğurur. Bağımlılık yönü tek yönlüdür —
 * `BookingModule` ve `PackagesModule` buraya bakar, bu modül onlara bakmaz.
 */
@Module({
  controllers: [
    ChargesController,
    DiscountsController,
    PaymentsController,
    CashController,
    CommissionsController,
  ],
  providers: [
    ChargesService,
    DiscountsService,
    ChargeGenerationService,
    PaymentsService,
    CashSessionsService,
    RefundsService,
    CommissionsService,
    CommissionAccrualService,
  ],
  exports: [
    ChargesService,
    ChargeGenerationService,
    PaymentsService,
    CashSessionsService,
    CommissionAccrualService,
  ],
})
export class FinanceModule {}
