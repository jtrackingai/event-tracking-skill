import { EventSchema, GA4Event, GA4Parameter } from '../generator/event-schema';
import { AggregatedLiveGtmEvent, LiveGtmAnalysis, LiveGtmTriggerType } from './live-parser';

export const LIVE_PREVIEW_RESULT_FILE = 'live-preview-result.json';
export const LIVE_PREVIEW_REPORT_FILE = 'live-preview-report.md';
export const LIVE_TRACKING_HEALTH_FILE = 'live-tracking-health.json';

export interface LiveVerificationBuildResult {
  schema: EventSchema;
  includedEvents: string[];
  skippedEvents: Array<{
    eventName: string;
    reason: string;
  }>;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function pickPrimaryTriggerType(event: AggregatedLiveGtmEvent): GA4Event['triggerType'] | null {
  const triggerTypes = uniq(event.triggerTypes);
  if (triggerTypes.includes('form_submit')) return 'form_submit';
  if (triggerTypes.includes('scroll')) return 'scroll';
  if (triggerTypes.includes('video')) return 'video';
  if (triggerTypes.includes('click')) return 'click';
  if (triggerTypes.includes('page_view')) return 'page_view';
  if (event.selectors.length > 0) return 'click';
  if (event.urlPatterns.length > 0) return 'page_view';
  if (triggerTypes.includes('custom')) return null;
  if (triggerTypes.includes('unknown')) return null;
  return null;
}

function inferPriority(eventName: string, triggerType: GA4Event['triggerType']): GA4Event['priority'] {
  const lower = eventName.toLowerCase();
  if (/(purchase|checkout|payment|begin_checkout|signup|register|contact|lead|demo|trial|submit)/.test(lower)) {
    return 'high';
  }
  if (triggerType === 'page_view' || triggerType === 'scroll') return 'low';
  return 'medium';
}

function buildParameters(parameterNames: string[]): GA4Parameter[] {
  return parameterNames.map(name => ({
    name,
    value: '(captured from published GTM runtime)',
    description: `Parameter observed in the published live GTM definition for this event.`,
  }));
}

function buildEventDescription(event: AggregatedLiveGtmEvent, triggerType: GA4Event['triggerType']): string {
  const containerSummary = event.containers.length > 0
    ? `parsed from ${event.containers.join(', ')}`
    : 'parsed from the published GTM runtime';
  return `Verifies the live ${event.eventName} event ${containerSummary} using ${triggerType} automation.`;
}

function buildVerificationEvent(event: AggregatedLiveGtmEvent): { event: GA4Event | null; skippedReason?: string } {
  const triggerType = pickPrimaryTriggerType(event);
  if (!triggerType) {
    return {
      event: null,
      skippedReason: 'No automation-friendly trigger hints were available from the published GTM runtime.',
    };
  }

  const pageUrlPattern = event.urlPatterns[0] || undefined;
  const elementSelector = (
    triggerType === 'click' || triggerType === 'form_submit'
  ) ? (event.selectors[0] || undefined) : undefined;

  if ((triggerType === 'click' || triggerType === 'form_submit') && !elementSelector) {
    return {
      event: null,
      skippedReason: 'The live event appears interaction-based, but no selector hint could be reconstructed.',
    };
  }

  return {
    event: {
      eventName: event.eventName,
      description: buildEventDescription(event, triggerType),
      triggerType,
      elementSelector,
      pageUrlPattern,
      parameters: buildParameters(event.parameterNames),
      priority: inferPriority(event.eventName, triggerType),
      notes: `Live verification target inferred from published GTM runtime (${event.confidence} confidence).`,
    },
  };
}

export function buildLiveVerificationSchema(liveAnalysis: LiveGtmAnalysis): LiveVerificationBuildResult {
  const events: GA4Event[] = [];
  const skippedEvents: LiveVerificationBuildResult['skippedEvents'] = [];

  for (const liveEvent of liveAnalysis.aggregatedEvents) {
    const built = buildVerificationEvent(liveEvent);
    if (!built.event) {
      skippedEvents.push({
        eventName: liveEvent.eventName,
        reason: built.skippedReason || 'No automation target could be built.',
      });
      continue;
    }
    events.push(built.event);
  }

  events.sort((left, right) => left.eventName.localeCompare(right.eventName));
  skippedEvents.sort((left, right) => left.eventName.localeCompare(right.eventName));

  return {
    schema: {
      siteUrl: liveAnalysis.siteUrl,
      generatedAt: new Date().toISOString(),
      events,
    },
    includedEvents: events.map(event => event.eventName),
    skippedEvents,
  };
}
