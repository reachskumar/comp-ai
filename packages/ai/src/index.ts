/**
 * @compensation/ai
 * Shared LangGraph.js infrastructure for the compensation platform.
 * Provides graph factories, state schemas, tools, streaming, and checkpointing.
 */

// Configuration
export {
  loadAIConfig,
  resolveModelConfig,
  createChatModel,
  type AIProvider,
  type AIConfig,
  type AzureConfig,
  type ModelConfig,
} from './config.js';

// Base state schema
export {
  BaseAgentState,
  type BaseAgentStateType,
  type BaseAgentStateUpdate,
  type GraphMetadata,
} from './state.js';

// Tool utilities
export { createDomainTool, type DomainToolOptions } from './tools.js';

// Pay Equity agent contract (every PE agent returns PayEquityAgentResult<T>)
export {
  buildResult,
  checkKAnonymity,
  checkSampleSize,
  type PayEquityAgentResult,
  type PayEquityMethodology,
  type PayEquityNarrativeOutput,
  type CohortRootCauseOutput,
  type RemediationOptimizationOutput,
  type GapProjectionOutput,
  type Citation,
  type CitationType,
  type AgentConfidence,
  type AgentWarning,
  type AgentWarningCode,
} from './types/pay-equity.js';

// Checkpointer
export { createCheckpointer } from './checkpointer.js';

// Graph factory
export {
  createAgentGraph,
  START,
  END,
  type GraphDefinition,
  type ConditionalEdge,
  type CreateGraphOptions,
  type NodeFunction,
} from './graph-factory.js';

// Streaming
export {
  streamGraphToSSE,
  formatSSE,
  sseToReadableStream,
  type SSEEvent,
  type SSEEventType,
} from './streaming.js';

// Copilot tools
export { createCopilotTools, type CopilotDbAdapter, type MirrorDbAdapter } from './tools/index.js';

// Graphs
export {
  buildEchoGraph,
  invokeEchoGraph,
  type EchoGraphInput,
  type EchoGraphOutput,
} from './graphs/echo-graph.js';

export {
  buildCopilotGraph,
  invokeCopilotGraph,
  type CopilotGraphInput,
  type CopilotGraphOutput,
  type CopilotUserRole,
  type CopilotUserContext,
} from './graphs/copilot-graph.js';

// Rules Orchestrator
export {
  buildRulesOrchestratorGraph,
  type RulesOrchestratorOptions,
  type ParsedRule,
  type ValidationResult,
  type CompportRuleMapping,
} from './graphs/rules-orchestrator-graph.js';

// Compliance tools
export { createComplianceTools, type ComplianceDbAdapter } from './tools/compliance-tools.js';

// Compliance scanner graph
export {
  buildComplianceScannerGraph,
  invokeComplianceScannerGraph,
  type ComplianceScannerInput,
  type ComplianceScannerOutput,
  type ComplianceFinding,
} from './graphs/compliance-scanner-graph.js';

export {
  buildAnomalyExplainerGraph,
  invokeAnomalyExplainerGraph,
  type AnomalyExplainerInput,
  type AnomalyExplainerOutput,
  type AnomalyExplainerResult,
  type AnomalyData,
} from './graphs/anomaly-explainer-graph.js';

export {
  buildFieldMappingGraph,
  invokeFieldMappingGraph,
  type FieldMappingGraphInput,
  type FieldMappingGraphOutput,
  type FieldSchema,
  type SuggestedMapping,
} from './graphs/field-mapping-graph.js';

// Report Builder tools
export {
  createReportBuilderTools,
  type ReportBuilderDbAdapter,
} from './tools/report-builder-tools.js';

// Report Builder graph
export {
  buildReportBuilderGraph,
  invokeReportBuilderGraph,
  type ReportBuilderGraphInput,
  type ReportBuilderGraphOutput,
} from './graphs/report-builder-graph.js';

// Data Quality tools
export { createDataQualityTools, type DataQualityDbAdapter } from './tools/data-quality-tools.js';

// Data Quality graph
export {
  buildDataQualityGraph,
  invokeDataQualityGraph,
  type DataQualityGraphInput,
  type DataQualityGraphOutput,
  type DataQualityReport,
  type DataQualityIssueGroup,
  type DataQualityIssueFixSuggestion,
  type DataQualityBulkFix,
} from './graphs/data-quality-graph.js';

// Simulation tools
export { createSimulationTools, type SimulationDbAdapter } from './tools/simulation-tools.js';

// Simulation graph
export {
  buildSimulationGraph,
  invokeSimulationGraph,
  type SimulationGraphInput,
  type SimulationGraphOutput,
} from './graphs/simulation-graph.js';

// Letter Generator
export {
  invokeLetterGenerator,
  type LetterGeneratorInput,
  type LetterGeneratorOutput,
  type LetterType,
  type LetterEmployeeData,
  type LetterCompData,
} from './graphs/letter-generator-graph.js';

// Pay Equity graphs
export {
  buildPayEquityGraph,
  invokePayEquityGraph,
  type PayEquityAnalysisInput,
  type PayEquityAnalysisOutput,
} from './graphs/pay-equity-graph.js';
export {
  buildCohortRootCauseGraph,
  invokeCohortRootCauseGraph,
  type CohortAnalysisInput,
} from './graphs/pay-equity-cohort-graph.js';
export {
  buildOutlierExplainerGraph,
  invokeOutlierExplainerGraph,
  type OutlierExplainInput,
  type OutlierExplainOutput,
} from './graphs/pay-equity-outlier-graph.js';

// Attrition Predictor tools
export { createAttritionTools, type AttritionDbAdapter } from './tools/attrition-tools.js';

// Attrition Predictor graph
export {
  buildAttritionPredictorGraph,
  invokeAttritionPredictor,
  type AttritionPredictorInput,
  type AttritionPredictorOutput,
} from './graphs/attrition-predictor-graph.js';

// Policy RAG tools
export {
  createPolicyRagTools,
  type PolicyRagDbAdapter,
  type EmbedFunction,
} from './tools/policy-rag-tools.js';

// Policy RAG graph
export {
  buildPolicyRagGraph,
  invokePolicyRagGraph,
  type PolicyRagGraphInput,
  type PolicyRagGraphOutput,
} from './graphs/policy-rag-graph.js';

// Calibration Assistant tools
export { createCalibrationTools, type CalibrationDbAdapter } from './tools/calibration-tools.js';

// Calibration Assistant graph
export {
  buildCalibrationAssistantGraph,
  invokeCalibrationAssistant,
  type CalibrationAssistantInput,
  type CalibrationAssistantOutput,
  type CalibrationSuggestion,
} from './graphs/calibration-assistant-graph.js';

// Budget Optimizer tools
export {
  createBudgetOptimizerTools,
  type BudgetOptimizerDbAdapter,
} from './tools/budget-optimizer-tools.js';

// Budget Optimizer graph
export {
  buildBudgetOptimizerGraph,
  invokeBudgetOptimizer,
  type BudgetOptimizerInput,
  type BudgetOptimizerOutput,
} from './graphs/budget-optimizer-graph.js';

// Rule Management tools
export {
  createRuleManagementTools,
  type RuleManagementDbAdapter,
} from './tools/rule-management-tools.js';

// Rule Analysis graph
export {
  buildRuleAnalysisGraph,
  invokeRuleAnalysisGraph,
  type RuleAnalysisInput,
  type RuleAnalysisOutput,
} from './graphs/rule-analysis-graph.js';
