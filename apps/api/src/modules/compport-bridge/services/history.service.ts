import { Injectable, Logger } from '@nestjs/common';
import { CompportCloudSqlService } from './compport-cloudsql.service';
import { WRITE_BACK_TABLES } from './write-back-field-map';

/**
 * History Service — Manages login_user_history insertion and salary cascade.
 *
 * CRITICAL INVARIANT from legacy Compport:
 * Before ANY update to login_user, the current row MUST be copied to login_user_history.
 * Every write path in the legacy PHP system does this (Rule_model::manage_users_history).
 *
 * Additionally handles the 5-level salary and date history cascade that occurs
 * when salary changes are applied.
 */
@Injectable()
export class CompportHistoryService {
  private readonly logger = new Logger(CompportHistoryService.name);

  constructor(private readonly cloudSql: CompportCloudSqlService) {}

  /**
   * Insert current login_user rows into login_user_history BEFORE updating.
   * This is the exact pattern from Rule_model::manage_users_history():
   *
   * ```sql
   * INSERT INTO login_user_history SELECT * FROM login_user WHERE id IN (...)
   * ```
   *
   * @param schemaName - Tenant database name
   * @param employeeIds - login_user.id values to snapshot
   * @returns Number of history rows inserted
   */
  async insertHistory(schemaName: string, employeeIds: string[]): Promise<number> {
    if (employeeIds.length === 0) return 0;

    const placeholders = employeeIds.map(() => '?').join(', ');
    const sql = `INSERT INTO \`${WRITE_BACK_TABLES.LOGIN_USER_HISTORY}\` SELECT * FROM \`${WRITE_BACK_TABLES.LOGIN_USER}\` WHERE id IN (${placeholders})`;

    const result = await this.cloudSql.executeQuery(schemaName, sql, employeeIds);
    const insertedCount = Array.isArray(result) ? result.length : 0;

    this.logger.log(
      `History snapshot: ${employeeIds.length} employees copied to login_user_history in ${schemaName}`,
    );

    return insertedCount;
  }

  /**
   * Build the salary history cascade SET clauses.
   *
   * When a salary change is applied, the 5-level cascade shifts:
   *   5th ← 4th ← 3rd ← 2nd ← last ← current total_comp (before update)
   *
   * Same pattern for effective dates.
   *
   * @returns Array of SET clause fragments for the UPDATE statement
   */
  buildSalaryCascadeSetClauses(): string[] {
    return [
      // Salary cascade: shift each level down
      '`total_salary_after_5th_last_increase` = `total_salary_after_4th_last_increase`',
      '`total_salary_after_4th_last_increase` = `total_salary_after_3rd_last_increase`',
      '`total_salary_after_3rd_last_increase` = `total_salary_after_2nd_last_increase`',
      '`total_salary_after_2nd_last_increase` = `total_salary_after_last_increase`',
      '`total_salary_after_last_increase` = `total_compensation`',
    ];
  }

  /**
   * Build the date history cascade SET clauses.
   *
   * Cascades effective dates the same way as salary values:
   *   5th ← 4th ← 3rd ← 2nd ← last ← current
   *
   * @param newEffectiveDate - The effective date for the current salary change
   * @returns Array of SET clause fragments for the UPDATE statement
   */
  buildDateCascadeSetClauses(newEffectiveDate: string): string[] {
    return [
      '`effective_date_of_5th_last_salary_increase` = `effective_date_of_4th_last_salary_increase`',
      '`effective_date_of_4th_last_salary_increase` = `effective_date_of_3rd_last_salary_increase`',
      '`effective_date_of_3rd_last_salary_increase` = `effective_date_of_2nd_last_salary_increase`',
      '`effective_date_of_2nd_last_salary_increase` = `effective_date_of_last_salary_increase`',
      '`effective_date_of_last_salary_increase` = `effective_date_of_current_salary_increase`',
      `\`effective_date_of_current_salary_increase\` = '${newEffectiveDate}'`,
    ];
  }

  /**
   * Build demographic update SET clauses with conditional logic.
   *
   * In legacy Compport, demographics only update if the new value is > 0:
   *   SET city = IF(new_city > 0, new_city, city)
   *
   * @param demographics - Map of column name → new value (from employee_salary_details)
   * @returns Array of SET clause fragments
   */
  buildDemographicSetClauses(demographics: Record<string, string | number>): string[] {
    const clauses: string[] = [];

    for (const [column, value] of Object.entries(demographics)) {
      if (value && Number(value) > 0) {
        clauses.push(`\`${column}\` = ?`);
      }
    }

    return clauses;
  }

  /**
   * Get the parameter values for demographic SET clauses.
   * Only includes values where the demographic actually changed (> 0).
   */
  getDemographicParams(demographics: Record<string, string | number>): (string | number)[] {
    const params: (string | number)[] = [];

    for (const [, value] of Object.entries(demographics)) {
      if (value && Number(value) > 0) {
        params.push(value);
      }
    }

    return params;
  }

  /**
   * Build metadata SET clauses (updatedon, updatedby, updatedby_proxy).
   */
  buildMetaSetClauses(updatedBy: string, proxyUserId?: string): string[] {
    const clauses = ['`updatedon` = NOW()', '`updatedby` = ?'];
    if (proxyUserId) {
      clauses.push('`updatedby_proxy` = ?');
    }
    return clauses;
  }

  /**
   * Get parameter values for metadata SET clauses.
   */
  getMetaParams(updatedBy: string, proxyUserId?: string): string[] {
    const params = [updatedBy];
    if (proxyUserId) {
      params.push(proxyUserId);
    }
    return params;
  }
}
