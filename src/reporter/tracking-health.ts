import * as fs from 'fs';
import * as path from 'path';

import { FailureCategory, PreviewResult } from '../gtm/preview';

export const TRACKING_HEALTH_FILE = 'tracking-health.json';
export const TRACKING_HEALTH_HISTORY_DIR = 'tracking-health-history';

export type TrackingHealthGrade = 'good' | 'warning' | 'critical' | 'manual_required';
export type TrackingHealthMode = 'automated' | 'manual_shopify_verification';

export interface TrackingHealthReport {
  schemaVersion: 1;
  generatedAt: string;
  siteUrl: string;
  gtmContainerId: string;
  mode: TrackingHealthMode;
  score: number | null;
  grade: TrackingHealthGrade;
  rawFiringRate: number;
  adjustedFiringRate: number;
  totalSchemaEvents: number;
  totalExpected: number;
  totalFired: number;
  totalFailed: number;
  redundantAutoEventsSkipped: number;
  actionableFailures: number;
  expectedManualFailures: number;
  highPriorityFailures: number;
  selectorMismatches: number;
  configErrors: number;
  unexpectedFiredCount: number;
  unexpectedEventNames: string[];
  blockers: string[];
  recommendations: string[];
  eventStatus: Array<{
    eventName: string;
    fired: boolean;
    priority: string;
    failureCategory?: FailureCategory;
  }>;
  baseline?: {
    file?: string;
    previousGeneratedAt?: string;
    previousScore: number | null;
    scoreDelta: number | null;
    fixedEvents: string[];
    newFailures: string[];
    changedEvents: Array<{
      eventName: string;
      before: 'fired' | 'failed';
      after: 'fired' | 'failed';
    }>;
  };
}

type TrackingHealthBaseline = NonNullable<TrackingHealthReport['baseline']>;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 100;
  return Math.round((numerator / denominator) * 100);
}

function getGrade(score: number): TrackingHealthGrade {
  if (score >= 85) return 'good';
  if (score >= 60) return 'warning';
  return 'critical';
}

function getEventStatusMap(report: TrackingHealthReport): Map<string, boolean> {
  return new Map(report.eventStatus.map(event => [event.eventName, event.fired]));
}

function buildBaselineDiff(current: TrackingHealthReport, baseline: TrackingHealthReport | null, baselineFile?: string): TrackingHealthReport['baseline'] {
  if (!baseline) return undefined;

  const before = getEventStatusMap(baseline);
  const after = getEventStatusMap(current);
  const allEventNames = Array.from(new Set([...before.keys(), ...after.keys()])).sort();
  const fixedEvents: string[] = [];
  const newFailures: string[] = [];
  const changedEvents: TrackingHealthBaseline['changedEvents'] = [];

  for (const eventName of allEventNames) {
    const previousFired = before.get(eventName);
    const currentFired = after.get(eventName);

    if (previousFired === undefined || currentFired === undefined || previousFired === currentFired) {
      continue;
    }

    const beforeLabel = previousFired ? 'fired' : 'failed';
    const afterLabel = currentFired ? 'fired' : 'failed';
    changedEvents.push({ eventName, before: beforeLabel, after: afterLabel });

    if (!previousFired && currentFired) {
      fixedEvents.push(eventName);
    } else if (previousFired && !currentFired) {
      newFailures.push(eventName);
    }
  }

  return {
    file: baselineFile,
    previousGeneratedAt: baseline.generatedAt,
    previousScore: baseline.score,
    scoreDelta:
      typeof current.score === 'number' && typeof baseline.score === 'number'
        ? current.score - baseline.score
        : null,
    fixedEvents,
    newFailures,
    changedEvents,
  };
}

export function buildTrackingHealthReport(
  result: PreviewResult,
  baseline?: TrackingHealthReport | null,
  baselineFile?: string,
): TrackingHealthReport {
  const totalSchemaEvents = typeof result.totalSchemaEvents === 'number' ? result.totalSchemaEvents : result.totalExpected;
  const redundantAutoEventsSkipped =
    typeof result.redundantAutoEventsSkipped === 'number'
      ? result.redundantAutoEventsSkipped
      : Math.max(0, totalSchemaEvents - result.totalExpected);
  const unexpectedFiredEvents = result.unexpectedFiredEvents || [];
  const unexpectedEventNames = Array.from(new Set(unexpectedFiredEvents.map(event => event.eventName))).sort();
  const failedResults = result.results.filter(item => !item.fired);
  const expectedManualFailures = failedResults.filter(item =>
    item.failureCategory === 'requires_login' || item.failureCategory === 'requires_journey'
  ).length;
  const actionableFailures = failedResults.length - expectedManualFailures;
  const highPriorityFailures = failedResults.filter(item => item.event.priority === 'high').length;
  const selectorMismatches = failedResults.filter(item => item.failureCategory === 'selector_mismatch').length;
  const configErrors = failedResults.filter(item => item.failureCategory === 'config_error').length;
  const rawFiringRate = getRate(result.totalFired, result.totalExpected);
  const adjustedFiringRate = getRate(result.totalFired + expectedManualFailures, result.totalExpected);
  const penalty = highPriorityFailures * 10 + configErrors * 8 + selectorMismatches * 6;
  const score = clamp(adjustedFiringRate - penalty, 0, 100);
  const blockers: string[] = [];
  const recommendations: string[] = [];

  if (highPriorityFailures > 0) {
    blockers.push(`${highPriorityFailures} high-priority event(s) did not fire.`);
  }
  if (configErrors > 0) {
    blockers.push(`${configErrors} event(s) look like GTM configuration errors.`);
    recommendations.push('Review measurement ID, GTM workspace sync state, and trigger configuration before publishing.');
  }
  if (selectorMismatches > 0) {
    blockers.push(`${selectorMismatches} selector mismatch(es) need schema or GTM trigger updates.`);
    recommendations.push('Fix selector mismatches in event-schema.json, regenerate GTM, sync, then preview again.');
  }
  if (expectedManualFailures > 0) {
    recommendations.push(`${expectedManualFailures} event(s) require manual journey or login validation.`);
  }
  if (unexpectedEventNames.length > 0) {
    recommendations.push(
      `Review unexpected fired events outside the approved schema: ${unexpectedEventNames.join(', ')}.`,
    );
  }
  if (blockers.length === 0) {
    recommendations.push('No automated preview blockers detected. Complete any manual checks before publish.');
  }

  const report: TrackingHealthReport = {
    schemaVersion: 1,
    generatedAt: result.previewEndedAt,
    siteUrl: result.siteUrl,
    gtmContainerId: result.gtmContainerId,
    mode: 'automated',
    score,
    grade: getGrade(score),
    rawFiringRate,
    adjustedFiringRate,
    totalSchemaEvents,
    totalExpected: result.totalExpected,
    totalFired: result.totalFired,
    totalFailed: result.totalFailed,
    redundantAutoEventsSkipped,
    actionableFailures,
    expectedManualFailures,
    highPriorityFailures,
    selectorMismatches,
    configErrors,
    unexpectedFiredCount: unexpectedFiredEvents.length,
    unexpectedEventNames,
    blockers,
    recommendations,
    eventStatus: result.results.map(item => ({
      eventName: item.event.eventName,
      fired: item.fired,
      priority: item.event.priority,
      failureCategory: item.failureCategory,
    })),
  };

  report.baseline = buildBaselineDiff(report, baseline || null, baselineFile);
  return report;
}

export function buildManualTrackingHealthReport(args: {
  siteUrl: string;
  gtmContainerId: string;
  generatedAt: string;
  reason: string;
  totalSchemaEvents?: number;
}): TrackingHealthReport {
  return {
    schemaVersion: 1,
    generatedAt: args.generatedAt,
    siteUrl: args.siteUrl,
    gtmContainerId: args.gtmContainerId,
    mode: 'manual_shopify_verification',
    score: null,
    grade: 'manual_required',
    rawFiringRate: 0,
    adjustedFiringRate: 0,
    totalSchemaEvents: args.totalSchemaEvents || 0,
    totalExpected: 0,
    totalFired: 0,
    totalFailed: 0,
    redundantAutoEventsSkipped: 0,
    actionableFailures: 0,
    expectedManualFailures: 0,
    highPriorityFailures: 0,
    selectorMismatches: 0,
    configErrors: 0,
    unexpectedFiredCount: 0,
    unexpectedEventNames: [],
    blockers: [args.reason],
    recommendations: ['Install and validate the Shopify custom pixel with GA4 Realtime and Shopify pixel debugging tools.'],
    eventStatus: [],
  };
}

export function readTrackingHealthReport(file: string): TrackingHealthReport | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as TrackingHealthReport;
    return parsed.schemaVersion === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeTrackingHealthReport(file: string, report: TrackingHealthReport): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
}

function sanitizeTimestampForPath(value: string): string {
  return value.replace(/[:]/g, '-');
}

export function writeTrackingHealthHistory(artifactDir: string, report: TrackingHealthReport): string {
  const historyDir = path.join(path.resolve(artifactDir), TRACKING_HEALTH_HISTORY_DIR);
  const historyFile = path.join(historyDir, `${sanitizeTimestampForPath(report.generatedAt)}.json`);
  writeTrackingHealthReport(historyFile, report);
  return historyFile;
}

export function formatTrackingHealthScore(score: number | null): string {
  return typeof score === 'number' ? `${score}/100` : 'n/a';
}

export function hasBlockingTrackingHealth(report: TrackingHealthReport | null | undefined): boolean {
  if (!report) return false;
  if (report.grade === 'manual_required' || report.mode === 'manual_shopify_verification') return true;
  if (report.grade === 'critical') return true;
  return report.blockers.length > 0;
}
