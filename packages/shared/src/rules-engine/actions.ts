/**
 * Action Handlers
 * Implements all rule action types for the compensation rules engine.
 */

import type { ActionType, AppliedAction, CurrentAmounts, EmployeeData, RuleAction } from './types.js';

// ─────────────────────────────────────────────────────────────
// Action handler type
// ─────────────────────────────────────────────────────────────

interface ActionResult {
  calculatedValue: number;
  description: string;
  /** Mutations to apply to currentAmounts */
  amountUpdates?: Partial<CurrentAmounts>;
  flag?: string;
  block?: string;
}

type ActionHandler = (
  action: RuleAction,
  employee: EmployeeData,
  currentAmounts: CurrentAmounts,
) => ActionResult;

// ─────────────────────────────────────────────────────────────
// Handler implementations
// ─────────────────────────────────────────────────────────────

const handlers: Record<ActionType, ActionHandler> = {
  setMerit: (action, employee, _current) => {
    const percentage = Number(action.params['percentage'] ?? 0);
    const amount = (employee.baseSalary * percentage) / 100;
    return {
      calculatedValue: amount,
      description: `Set merit increase to ${percentage}% of base salary ($${amount.toFixed(2)})`,
      amountUpdates: { merit: amount },
    };
  },

  setBonus: (action, employee, _current) => {
    const percentage = action.params['percentage'] as number | undefined;
    const fixedAmount = action.params['amount'] as number | undefined;
    const amount = fixedAmount ?? (employee.baseSalary * (percentage ?? 0)) / 100;
    return {
      calculatedValue: amount,
      description: percentage
        ? `Set bonus to ${percentage}% of base salary ($${amount.toFixed(2)})`
        : `Set bonus to fixed amount $${amount.toFixed(2)}`,
      amountUpdates: { bonus: amount },
    };
  },

  setLTI: (action, employee, _current) => {
    const percentage = action.params['percentage'] as number | undefined;
    const fixedAmount = action.params['amount'] as number | undefined;
    const amount = fixedAmount ?? (employee.baseSalary * (percentage ?? 0)) / 100;
    return {
      calculatedValue: amount,
      description: percentage
        ? `Set LTI to ${percentage}% of base salary ($${amount.toFixed(2)})`
        : `Set LTI to fixed amount $${amount.toFixed(2)}`,
      amountUpdates: { lti: amount },
    };
  },

  applyMultiplier: (action, _employee, current) => {
    const multiplier = Number(action.params['multiplier'] ?? 1);
    const target = (action.params['target'] as string) ?? 'merit';
    let baseAmount = 0;
    const updates: Partial<CurrentAmounts> = {};

    if (target === 'merit') {
      baseAmount = current.merit;
      updates.merit = current.merit * multiplier;
    } else if (target === 'bonus') {
      baseAmount = current.bonus;
      updates.bonus = current.bonus * multiplier;
    } else if (target === 'lti') {
      baseAmount = current.lti;
      updates.lti = current.lti * multiplier;
    }

    const newAmount = baseAmount * multiplier;
    return {
      calculatedValue: newAmount,
      description: `Applied ${multiplier}x multiplier to ${target} ($${baseAmount.toFixed(2)} → $${newAmount.toFixed(2)})`,
      amountUpdates: updates,
    };
  },

  applyFloor: (action, _employee, current) => {
    const floor = Number(action.params['amount'] ?? 0);
    const target = (action.params['target'] as string) ?? 'merit';
    const updates: Partial<CurrentAmounts> = {};
    let currentVal = 0;

    if (target === 'merit') {
      currentVal = current.merit;
      if (current.merit < floor) updates.merit = floor;
    } else if (target === 'bonus') {
      currentVal = current.bonus;
      if (current.bonus < floor) updates.bonus = floor;
    } else if (target === 'lti') {
      currentVal = current.lti;
      if (current.lti < floor) updates.lti = floor;
    }

    const applied = Math.max(currentVal, floor);
    return {
      calculatedValue: applied,
      description: `Applied floor of $${floor.toFixed(2)} to ${target} (was $${currentVal.toFixed(2)}, now $${applied.toFixed(2)})`,
      amountUpdates: updates,
    };
  },

  applyCap: (action, _employee, current) => {
    const cap = Number(action.params['amount'] ?? Infinity);
    const target = (action.params['target'] as string) ?? 'merit';
    const updates: Partial<CurrentAmounts> = {};
    let currentVal = 0;

    if (target === 'merit') {
      currentVal = current.merit;
      if (current.merit > cap) updates.merit = cap;
    } else if (target === 'bonus') {
      currentVal = current.bonus;
      if (current.bonus > cap) updates.bonus = cap;
    } else if (target === 'lti') {
      currentVal = current.lti;
      if (current.lti > cap) updates.lti = cap;
    }

    const applied = Math.min(currentVal, cap);
    return {
      calculatedValue: applied,
      description: `Applied cap of $${cap.toFixed(2)} to ${target} (was $${currentVal.toFixed(2)}, now $${applied.toFixed(2)})`,
      amountUpdates: updates,
    };
  },

  flag: (action) => {
    const message = String(action.params['message'] ?? 'Flagged for review');
    return {
      calculatedValue: 0,
      description: `Flag: ${message}`,
      flag: message,
    };
  },

  block: (action) => {
    const reason = String(action.params['reason'] ?? 'Blocked by rule');
    return {
      calculatedValue: 0,
      description: `Block: ${reason}`,
      block: reason,
    };
  },
};

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export interface ExecuteActionResult {
  appliedAction: AppliedAction;
  amountUpdates: Partial<CurrentAmounts>;
  flag?: string;
  block?: string;
}

/**
 * Execute a single rule action against an employee.
 */
export function executeAction(
  action: RuleAction,
  employee: EmployeeData,
  currentAmounts: CurrentAmounts,
): ExecuteActionResult {
  const handler = handlers[action.type];
  const result = handler(action, employee, currentAmounts);

  return {
    appliedAction: {
      type: action.type,
      params: action.params,
      calculatedValue: result.calculatedValue,
      description: result.description,
    },
    amountUpdates: result.amountUpdates ?? {},
    flag: result.flag,
    block: result.block,
  };
}

