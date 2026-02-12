import { Module } from '@nestjs/common';
import { RulesController } from './rules.controller';
import { PolicyConverterService } from './services/policy-converter.service';
import { RuleSetCrudService, RuleCrudService } from './services/rules-crud.service';
import { SimulatorService } from './services/simulator.service';
import { TestGeneratorService } from './services/test-generator.service';
import { TestRunnerService } from './services/test-runner.service';

@Module({
  controllers: [RulesController],
  providers: [
    PolicyConverterService,
    RuleSetCrudService,
    RuleCrudService,
    SimulatorService,
    TestGeneratorService,
    TestRunnerService,
  ],
  exports: [
    PolicyConverterService,
    RuleSetCrudService,
    RuleCrudService,
    SimulatorService,
    TestGeneratorService,
    TestRunnerService,
  ],
})
export class RulesModule {}

