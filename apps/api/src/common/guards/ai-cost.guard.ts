import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { MetricsService } from '../services/metrics.service';

/**
 * Guard that enforces per-tenant AI cost limits.
 * Apply to AI-powered endpoints (copilot, compliance, policy-rag, etc.).
 *
 * Default budget: $50/tenant/month (configurable via AI_MONTHLY_BUDGET_CENTS env var).
 */
@Injectable()
export class AiCostGuard implements CanActivate {
  private readonly logger = new Logger(AiCostGuard.name);
  private readonly monthlyBudgetCents: number;

  constructor(private readonly metrics: MetricsService) {
    this.monthlyBudgetCents = parseInt(process.env['AI_MONTHLY_BUDGET_CENTS'] ?? '5000', 10);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { tenantId?: string } | undefined;
    const tenantId = user?.tenantId;

    if (!tenantId) return true; // Let auth guards handle missing tenant

    const costCents = this.metrics.getTenantAiCostCents(tenantId);
    if (costCents >= this.monthlyBudgetCents) {
      this.logger.warn(
        `AI budget exceeded for tenant ${tenantId}: $${(costCents / 100).toFixed(2)} / $${(this.monthlyBudgetCents / 100).toFixed(2)}`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Monthly AI usage limit exceeded. Contact support to increase your quota.',
          currentCost: costCents / 100,
          budgetLimit: this.monthlyBudgetCents / 100,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
