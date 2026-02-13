export { PayrollModule } from './payroll.module';
export { PayrollController } from './payroll.controller';
export { AnomalyDetectorService } from './services/anomaly-detector.service';
export type { AnomalyReport, DetectedAnomaly, AnomalyDetail, AnomalyDetectorConfig } from './services/anomaly-detector.service';
export { TraceabilityService } from './services/traceability.service';
export type { TraceStep, TraceReport } from './services/traceability.service';
export { ReconciliationService } from './services/reconciliation.service';
export type { ReconciliationReport, ReconciliationSummary } from './services/reconciliation.service';
export { AnomalyExplainerService } from './services/anomaly-explainer.service';
export type { ExplanationResponse } from './services/anomaly-explainer.service';
export { ReconciliationProcessor } from './processors/reconciliation.processor';

