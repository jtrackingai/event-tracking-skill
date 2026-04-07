import { EventSchema } from './event-schema';
import { LiveGtmAnalysis, LiveGtmConfidence, LiveGtmTriggerType } from '../gtm/live-parser';

export interface ExistingTrackingBaselineEvent {
  eventName: string;
  containers: string[];
  measurementIds: string[];
  parameterNames: string[];
  triggerTypes: LiveGtmTriggerType[];
  selectors: string[];
  urlPatterns: string[];
  confidence: LiveGtmConfidence;
}

export interface ExistingTrackingBaseline {
  primaryContainerId: string | null;
  comparedContainerIds: string[];
  totalLiveEvents: number;
  measurementIds: string[];
  events: ExistingTrackingBaselineEvent[];
  observedProblems: string[];
  schemaGoals: string[];
}

export interface LiveTrackingChange {
  eventName: string;
  status: 'reused' | 'new';
  liveParameterNames: string[];
  schemaParameterNames: string[];
  improvements: string[];
}

export interface LiveTrackingDelta {
  primaryContainerId: string | null;
  comparedContainerIds: string[];
  liveEventCount: number;
  schemaEventCount: number;
  reusedEventCount: number;
  newEventCount: number;
  changes: LiveTrackingChange[];
  problemsSolved: string[];
  benefits: string[];
  carryOverWarnings: string[];
}

const STANDARD_PAGE_PARAMS = ['page_location', 'page_title', 'page_referrer'];
const CLICK_CONTEXT_PARAMS = ['link_text', 'link_url'];
const MAX_PROBLEM_ITEMS = 6;

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function truncateList(values: string[], max = MAX_PROBLEM_ITEMS): string[] {
  return values.slice(0, max);
}

export function buildExistingTrackingBaseline(liveAnalysis: LiveGtmAnalysis): ExistingTrackingBaseline {
  const events = liveAnalysis.aggregatedEvents.map(event => ({
    eventName: event.eventName,
    containers: event.containers,
    measurementIds: event.measurementIds,
    parameterNames: event.parameterNames,
    triggerTypes: event.triggerTypes,
    selectors: event.selectors,
    urlPatterns: event.urlPatterns,
    confidence: event.confidence,
  }));

  const comparedContainerIds = liveAnalysis.containers.map(container => container.publicId);
  const measurementIds = uniq(events.flatMap(event => event.measurementIds));
  const observedProblems: string[] = [];
  const schemaGoals: string[] = [];

  if (events.length === 0) {
    observedProblems.push('The live GTM runtime did not expose any GA4 event tags, so current coverage is effectively opaque.');
  }

  if (comparedContainerIds.length > 1) {
    observedProblems.push(
      `Live tracking is split across ${comparedContainerIds.length} GTM containers. Use \`${liveAnalysis.primaryContainerId}\` as the primary comparison baseline and treat the others as supporting context.`,
    );
  }

  const missingPageContextCount = events.filter(event =>
    STANDARD_PAGE_PARAMS.some(param => !event.parameterNames.includes(param)),
  ).length;
  if (missingPageContextCount > 0) {
    observedProblems.push(
      `${missingPageContextCount} live event(s) do not carry a consistent page context yet. Use shared page parameters to make GA4 reports comparable across events.`,
    );
  }

  const lowConfidenceCount = events.filter(event => event.confidence === 'low').length;
  if (lowConfidenceCount > 0) {
    observedProblems.push(
      `${lowConfidenceCount} live event(s) could only be reconstructed partially from the public runtime container. Review trigger assumptions before reusing those definitions verbatim.`,
    );
  }

  if (measurementIds.length > 1) {
    observedProblems.push(
      `Live tracking currently targets multiple measurement destinations (${measurementIds.join(', ')}), which can fragment reporting.`,
    );
  }

  const reusableNames = truncateList(events.map(event => event.eventName));
  if (reusableNames.length > 0) {
    schemaGoals.push(`Reuse existing live event names when the intent matches: ${reusableNames.join(', ')}.`);
  }
  if (missingPageContextCount > 0) {
    schemaGoals.push('Standardize page-level context (`page_location`, `page_title`, `page_referrer`) across high-value events.');
  }
  if (comparedContainerIds.length > 1 && liveAnalysis.primaryContainerId) {
    schemaGoals.push(`Use \`${liveAnalysis.primaryContainerId}\` as the naming baseline to avoid cross-container drift.`);
  }
  if (events.length === 0) {
    schemaGoals.push('Treat the live baseline as a gap analysis input and generate the first explicit reviewed GA4 event plan for the site.');
  }

  return {
    primaryContainerId: liveAnalysis.primaryContainerId,
    comparedContainerIds,
    totalLiveEvents: events.length,
    measurementIds,
    events,
    observedProblems,
    schemaGoals,
  };
}

export function compareSchemaToLiveTracking(schema: EventSchema, liveAnalysis: LiveGtmAnalysis): LiveTrackingDelta {
  const baseline = buildExistingTrackingBaseline(liveAnalysis);
  const liveByName = new Map(baseline.events.map(event => [event.eventName, event]));
  const changes: LiveTrackingChange[] = [];
  const problemsSolved: string[] = [];
  const benefits: string[] = [];

  let reusedEventCount = 0;
  let newEventCount = 0;
  let pageContextUpgradeCount = 0;
  let clickContextUpgradeCount = 0;

  for (const event of schema.events) {
    const liveEvent = liveByName.get(event.eventName);
    const schemaParameterNames = uniq(event.parameters.map(parameter => parameter.name));
    const improvements: string[] = [];

    if (liveEvent) {
      reusedEventCount += 1;

      const missingPageParams = STANDARD_PAGE_PARAMS.filter(param =>
        schemaParameterNames.includes(param) && !liveEvent.parameterNames.includes(param),
      );
      const missingClickParams = CLICK_CONTEXT_PARAMS.filter(param =>
        schemaParameterNames.includes(param) && !liveEvent.parameterNames.includes(param),
      );

      if (missingPageParams.length > 0) {
        pageContextUpgradeCount += 1;
        improvements.push(`adds page context: ${missingPageParams.join(', ')}`);
      }
      if (missingClickParams.length > 0) {
        clickContextUpgradeCount += 1;
        improvements.push(`adds click context: ${missingClickParams.join(', ')}`);
      }
      if (schemaParameterNames.length > liveEvent.parameterNames.length && improvements.length === 0) {
        improvements.push(`expands reporting context from ${liveEvent.parameterNames.length} to ${schemaParameterNames.length} parameter(s)`);
      }

      changes.push({
        eventName: event.eventName,
        status: 'reused',
        liveParameterNames: liveEvent.parameterNames,
        schemaParameterNames,
        improvements,
      });
      continue;
    }

    newEventCount += 1;
    improvements.push(`covers a live tracking gap on ${event.pageUrlPattern || 'all pages'}`);
    changes.push({
      eventName: event.eventName,
      status: 'new',
      liveParameterNames: [],
      schemaParameterNames,
      improvements,
    });
  }

  if (baseline.totalLiveEvents === 0) {
    problemsSolved.push('Introduces the first explicit GA4 event schema against a live GTM setup that did not expose any reviewed GA4 event tags.');
  }

  if (newEventCount > 0) {
    const addedEvents = truncateList(
      changes.filter(change => change.status === 'new').map(change => `\`${change.eventName}\``),
    );
    problemsSolved.push(`Adds dedicated tracking for missing live coverage: ${addedEvents.join(', ')}.`);
    benefits.push(`Broader coverage of high-value journeys with ${newEventCount} net-new event(s).`);
  }

  if (pageContextUpgradeCount > 0) {
    problemsSolved.push('Normalizes page context on reused live events so GA4 reports can be sliced consistently by page URL, title, and referrer.');
    benefits.push('Reporting becomes easier to compare across CTA, content, and conversion events because the page context is standardized.');
  }

  if (clickContextUpgradeCount > 0) {
    problemsSolved.push('Adds click-level context to reused live events that previously had only partial payloads.');
    benefits.push('CTA analysis improves because the event payload now retains button or link-level context.');
  }

  if (baseline.comparedContainerIds.length > 1 && baseline.primaryContainerId) {
    problemsSolved.push(
      `Uses \`${baseline.primaryContainerId}\` as the reviewed naming baseline, which reduces drift when live tracking is split across multiple GTM containers.`,
    );
  }

  if (reusedEventCount > 0) {
    benefits.push('Existing live event names can be preserved where the intent already matches, which helps keep downstream reporting continuity.');
  }

  return {
    primaryContainerId: baseline.primaryContainerId,
    comparedContainerIds: baseline.comparedContainerIds,
    liveEventCount: baseline.totalLiveEvents,
    schemaEventCount: schema.events.length,
    reusedEventCount,
    newEventCount,
    changes,
    problemsSolved: uniq(problemsSolved),
    benefits: uniq(benefits),
    carryOverWarnings: liveAnalysis.warnings,
  };
}
