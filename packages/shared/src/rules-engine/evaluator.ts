/**
 * Rule Evaluator
 * Main entry point for evaluating a rule set against an employee.
 * Handles priority ordering, conflict resolution, cap/floor enforcement, and audit trail.
 */

import type {
  AuditEntry,
  CurrentAmounts,
  EmployeeData,
  Rule,
  RuleDecision,
  RuleEvaluationResult,
  RuleSet,
} from './types.js';
import { evaluateAllConditions } from './operators.js';
import { executeAction } from './actions.js';

/**
 * Evaluate all rules in a rule set against an employee.
 *
 * Logic:
 * 1. Sort rules by priority (ascending = highest priority first)
 * 2. For each enabled rule, evaluate conditions (AND logic)
 * 3. If matched, execute actions and record in audit trail
 * 4. Block actions prevent all compensation changes
 * 5. Caps and floors are applied after all other rules
 * 6. Aggregate results: sum merit, bonus, LTI amounts
 */
export function evaluateRules(
  employee: EmployeeData,
  ruleSet: RuleSet,
): RuleEvaluationResult {
  const decisions: RuleDecision[] = [];
  const appliedRules: string[] = [];
  const skippedRules: string[] = [];
  const auditTrail: AuditEntry[] = [];
  const warnings: string[] = [];
  const flags: string[] = [];
  let blocked = false;
  let blockReason = '';

  const currentAmounts: CurrentAmounts = { merit: 0, bonus: 0, lti: 0 };

  // Sort rules by priority (ascending — lower number = higher priority)
  const sortedRules = [...ruleSet.rules].sort((a, b) => a.priority - b.priority);

  // Separate cap/floor rules from regular rules
  const regularRules: Rule[] = [];
  const capFloorRules: Rule[] = [];

  for (const rule of sortedRules) {
    if (!rule.enabled) {
      skippedRules.push(rule.id);
      auditTrail.push({
        ruleId: rule.id,
        ruleName: rule.name,
        matched: false,
        conditionResults: [],
        timestamp: new Date(),
      });
      continue;
    }

    const hasCapFloor = rule.actions.some(
      (a) => a.type === 'applyCap' || a.type === 'applyFloor',
    );
    if (hasCapFloor) {
      capFloorRules.push(rule);
    } else {
      regularRules.push(rule);
    }
  }

  // Phase 1: Evaluate regular rules
  for (const rule of regularRules) {
    const { allPassed, results } = evaluateAllConditions(employee, rule.conditions);

    auditTrail.push({
      ruleId: rule.id,
      ruleName: rule.name,
      matched: allPassed,
      conditionResults: results,
      timestamp: new Date(),
    });

    if (!allPassed) {
      skippedRules.push(rule.id);
      continue;
    }

    appliedRules.push(rule.id);
    const decision: RuleDecision = {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.type,
      actions: [],
    };

    for (const action of rule.actions) {
      const result = executeAction(action, employee, currentAmounts);
      decision.actions.push(result.appliedAction);

      // Apply amount updates
      if (result.amountUpdates.merit !== undefined) currentAmounts.merit = result.amountUpdates.merit;
      if (result.amountUpdates.bonus !== undefined) currentAmounts.bonus = result.amountUpdates.bonus;
      if (result.amountUpdates.lti !== undefined) currentAmounts.lti = result.amountUpdates.lti;

      if (result.flag) flags.push(result.flag);
      if (result.block) {
        blocked = true;
        blockReason = result.block;
      }
    }

    decisions.push(decision);
  }

  // If blocked, zero out all compensation
  if (blocked) {
    currentAmounts.merit = 0;
    currentAmounts.bonus = 0;
    currentAmounts.lti = 0;
    warnings.push(`Employee blocked: ${blockReason}`);
  }

  // Phase 2: Apply cap/floor rules (only if not blocked)
  if (!blocked) {
    for (const rule of capFloorRules) {
      const { allPassed, results } = evaluateAllConditions(employee, rule.conditions);

      auditTrail.push({
        ruleId: rule.id,
        ruleName: rule.name,
        matched: allPassed,
        conditionResults: results,
        timestamp: new Date(),
      });

      if (!allPassed) {
        skippedRules.push(rule.id);
        continue;
      }

      appliedRules.push(rule.id);
      const decision: RuleDecision = {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.type,
        actions: [],
      };

      for (const action of rule.actions) {
        const result = executeAction(action, employee, currentAmounts);
        decision.actions.push(result.appliedAction);

        if (result.amountUpdates.merit !== undefined) currentAmounts.merit = result.amountUpdates.merit;
        if (result.amountUpdates.bonus !== undefined) currentAmounts.bonus = result.amountUpdates.bonus;
        if (result.amountUpdates.lti !== undefined) currentAmounts.lti = result.amountUpdates.lti;

        if (result.flag) flags.push(result.flag);
      }

      decisions.push(decision);
    }
  }

  return {
    employeeId: employee.id,
    decisions,
    appliedRules,
    skippedRules,
    auditTrail,
    warnings,
    totalMerit: currentAmounts.merit,
    totalBonus: currentAmounts.bonus,
    totalLTI: currentAmounts.lti,
    blocked,
    flags,
  };
}

