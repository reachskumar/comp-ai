/**
 * @compensation/ai
 * Shared LangGraph.js infrastructure for the compensation platform.
 * Provides graph factories, state schemas, tools, streaming, and checkpointing.
 */

// Configuration
export { loadAIConfig, resolveModelConfig, type AIConfig, type ModelConfig } from './config.js';

// Base state schema
export {
  BaseAgentState,
  type BaseAgentStateType,
  type BaseAgentStateUpdate,
  type GraphMetadata,
} from './state.js';

// Tool utilities
export { createDomainTool, type DomainToolOptions } from './tools.js';

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
export { createCopilotTools, type CopilotDbAdapter } from './tools/index.js';

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
} from './graphs/copilot-graph.js';

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

// Letter Generator graph
export {
  buildLetterGeneratorGraph,
  invokeLetterGenerator,
  type LetterGeneratorInput,
  type LetterGeneratorOutput,
  type LetterType,
  type LetterEmployeeData,
  type LetterCompData,
} from './graphs/letter-generator-graph.js';

// Pay Equity graph
export {
  buildPayEquityGraph,
  invokePayEquityGraph,
  type PayEquityAnalysisInput,
  type PayEquityAnalysisOutput,
} from './graphs/pay-equity-graph.js';

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
