import { Module } from '@nestjs/common';
import { RulesController } from './rules.controller';
import { PolicyConverterService } from './services/policy-converter.service';
import { RuleSetCrudService, RuleCrudService } from './services/rules-crud.service';
import { SimulatorService } from './services/simulator.service';
import { TestGeneratorService } from './services/test-generator.service';
import { TestRunnerService } from './services/test-runner.service';
import { RuleGeneratorService } from './services/rule-generator.service';
import { LlmRuleGeneratorService } from './services/llm-rule-generator.service';
import { RuleUploadService } from './services/rule-upload.service';

@Module({
  controllers: [RulesController],
  providers: [
    PolicyConverterService,
    RuleSetCrudService,
    RuleCrudService,
    SimulatorService,
    TestGeneratorService,
    TestRunnerService,
    RuleGeneratorService,
    LlmRuleGeneratorService,
    RuleUploadService,
  ],
  exports: [
    PolicyConverterService,
    RuleSetCrudService,
    RuleCrudService,
    SimulatorService,
    TestGeneratorService,
    TestRunnerService,
    RuleGeneratorService,
    LlmRuleGeneratorService,
    RuleUploadService,
  ],
})
export class RulesModule {}
