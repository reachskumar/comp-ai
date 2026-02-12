import { Module } from '@nestjs/common';
import { BenefitsController } from './benefits.controller';
import { BenefitsService } from './benefits.service';
import { EncryptionService } from './services/encryption.service';
import { PremiumCalculatorService } from './services/premium-calculator.service';

@Module({
  controllers: [BenefitsController],
  providers: [BenefitsService, EncryptionService, PremiumCalculatorService],
  exports: [BenefitsService, EncryptionService, PremiumCalculatorService],
})
export class BenefitsModule {}

