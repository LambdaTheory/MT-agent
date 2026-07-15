export type UsabilityFailureLayer = 'capability' | 'metadata' | 'routing' | 'workflow' | 'data_health' | 'reply_channel';

export type InteractionResponseType = 'text' | 'clarification_card' | 'strategy_card' | 'execute_confirm_card' | 'none';

export interface CapabilityAuditResult {
  layer: 'capability';
  caseId: string;
  ok: boolean;
  toolName: string;
  evidence: string;
  failureLayer?: UsabilityFailureLayer;
}

export interface RoutingAuditResult {
  layer: 'routing';
  caseId: string;
  ok: boolean;
  utterance: string;
  matchedTool?: string;
  responseType: InteractionResponseType;
  evidence: string;
  failureLayer?: UsabilityFailureLayer;
}

export type InteractionAuditDetail = CapabilityAuditResult | RoutingAuditResult;

export interface InteractionUsabilityReport {
  generatedAt: string;
  capabilityPassed: string[];
  routingPassed: string[];
  blockedByCapability: string[];
  blockedByRouting: string[];
  blockedByMetadata: string[];
  blockedByWorkflow: string[];
  blockedByDataHealth: string[];
  blockedByReplyChannel: string[];
  details: InteractionAuditDetail[];
}

export interface BuildInteractionUsabilityReportOptions {
  generatedAt?: string;
}

function normalizedFailureLayer(detail: InteractionAuditDetail): UsabilityFailureLayer {
  if (detail.failureLayer && !(detail.layer === 'routing' && detail.failureLayer === 'capability')) return detail.failureLayer;
  return detail.layer === 'capability' ? 'capability' : 'routing';
}

export function buildInteractionUsabilityReport(
  details: InteractionAuditDetail[],
  options: BuildInteractionUsabilityReportOptions = {},
): InteractionUsabilityReport {
  const report: InteractionUsabilityReport = {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    capabilityPassed: [],
    routingPassed: [],
    blockedByCapability: [],
    blockedByRouting: [],
    blockedByMetadata: [],
    blockedByWorkflow: [],
    blockedByDataHealth: [],
    blockedByReplyChannel: [],
    details,
  };

  for (const detail of details) {
    if (detail.ok) {
      if (detail.layer === 'capability') report.capabilityPassed.push(detail.caseId);
      if (detail.layer === 'routing') report.routingPassed.push(detail.caseId);
      continue;
    }

    switch (normalizedFailureLayer(detail)) {
      case 'capability':
        report.blockedByCapability.push(detail.caseId);
        break;
      case 'metadata':
        report.blockedByMetadata.push(detail.caseId);
        break;
      case 'routing':
        report.blockedByRouting.push(detail.caseId);
        break;
      case 'workflow':
        report.blockedByWorkflow.push(detail.caseId);
        break;
      case 'data_health':
        report.blockedByDataHealth.push(detail.caseId);
        break;
      case 'reply_channel':
        report.blockedByReplyChannel.push(detail.caseId);
        break;
      default:
        report.blockedByCapability.push(detail.caseId);
        break;
    }
  }

  return report;
}
