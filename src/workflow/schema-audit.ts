import * as fs from 'fs';
import * as path from 'path';

import { EventSchema, GA4Event } from '../generator/event-schema';
import { getSchemaHash } from './state';

export const SCHEMA_DECISION_AUDIT_FILE = 'schema-decisions.jsonl';
export const SCHEMA_RESTORE_DIR = 'schema-restore';

export interface SchemaDecisionAuditEntry {
  schemaVersion: 1;
  recordedAt: string;
  action: 'schema_confirmed';
  artifactDir: string;
  schemaFile: string;
  currentHash: string;
  previousConfirmedHash?: string;
  restoreFile: string;
  previousRestoreFile?: string;
  summary: {
    totalEvents: number;
    added: string[];
    removed: string[];
    changed: string[];
    unchanged: string[];
  };
  events: Array<{
    eventName: string;
    decision: 'added' | 'removed' | 'changed' | 'unchanged';
    triggerType?: string;
    priority?: string;
    reason: string;
  }>;
}

export interface SchemaConfirmationAuditResult {
  auditFile: string;
  restoreFile: string;
  entry: SchemaDecisionAuditEntry;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

function getRestoreDir(artifactDir: string): string {
  return path.join(artifactDir, SCHEMA_RESTORE_DIR);
}

function getRestoreFile(artifactDir: string, schemaHash: string): string {
  return path.join(getRestoreDir(artifactDir), `confirmed-${schemaHash}.json`);
}

function readPreviousConfirmedSchema(artifactDir: string, schemaHash?: string): { file?: string; schema?: EventSchema } {
  if (!schemaHash) return {};

  const restoreFile = getRestoreFile(artifactDir, schemaHash);
  if (!fs.existsSync(restoreFile)) return {};

  try {
    return {
      file: restoreFile,
      schema: JSON.parse(fs.readFileSync(restoreFile, 'utf8')) as EventSchema,
    };
  } catch {
    return { file: restoreFile };
  }
}

function eventSignature(event: GA4Event): string {
  return stableStringify({
    description: event.description,
    triggerType: event.triggerType,
    elementSelector: event.elementSelector,
    pageUrlPattern: event.pageUrlPattern,
    parameters: event.parameters,
    priority: event.priority,
    notes: event.notes,
  });
}

function compareSchemas(previous: EventSchema | undefined, current: EventSchema) {
  const previousEvents = new Map((previous?.events || []).map(event => [event.eventName, event]));
  const currentEvents = new Map(current.events.map(event => [event.eventName, event]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  const events: SchemaDecisionAuditEntry['events'] = [];

  for (const event of current.events) {
    const previousEvent = previousEvents.get(event.eventName);
    if (!previousEvent) {
      added.push(event.eventName);
      events.push({
        eventName: event.eventName,
        decision: 'added',
        triggerType: event.triggerType,
        priority: event.priority,
        reason: previous ? 'New event compared with the previous confirmed schema.' : 'Initial confirmed schema event.',
      });
      continue;
    }

    if (eventSignature(previousEvent) !== eventSignature(event)) {
      changed.push(event.eventName);
      events.push({
        eventName: event.eventName,
        decision: 'changed',
        triggerType: event.triggerType,
        priority: event.priority,
        reason: 'Event definition changed compared with the previous confirmed schema.',
      });
      continue;
    }

    unchanged.push(event.eventName);
    events.push({
      eventName: event.eventName,
      decision: 'unchanged',
      triggerType: event.triggerType,
      priority: event.priority,
      reason: 'Event definition matches the previous confirmed schema.',
    });
  }

  for (const event of previous?.events || []) {
    if (currentEvents.has(event.eventName)) continue;
    removed.push(event.eventName);
    events.push({
      eventName: event.eventName,
      decision: 'removed',
      triggerType: event.triggerType,
      priority: event.priority,
      reason: 'Event existed in the previous confirmed schema but is absent from the current confirmation.',
    });
  }

  return { added, removed, changed, unchanged, events };
}

export function recordSchemaConfirmationAudit(args: {
  artifactDir: string;
  schemaFile: string;
  schema: EventSchema;
  previousConfirmedHash?: string;
}): SchemaConfirmationAuditResult {
  const artifactDir = path.resolve(args.artifactDir);
  const schemaFile = path.resolve(args.schemaFile);
  const currentHash = getSchemaHash(args.schema);
  const restoreDir = getRestoreDir(artifactDir);
  const restoreFile = getRestoreFile(artifactDir, currentHash);
  const auditFile = path.join(artifactDir, SCHEMA_DECISION_AUDIT_FILE);
  const previous = readPreviousConfirmedSchema(artifactDir, args.previousConfirmedHash);

  fs.mkdirSync(restoreDir, { recursive: true });
  if (!fs.existsSync(restoreFile)) {
    fs.writeFileSync(restoreFile, `${JSON.stringify(args.schema, null, 2)}\n`);
  }

  const diff = compareSchemas(previous.schema, args.schema);
  const entry: SchemaDecisionAuditEntry = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    action: 'schema_confirmed',
    artifactDir,
    schemaFile,
    currentHash,
    previousConfirmedHash: args.previousConfirmedHash,
    restoreFile,
    previousRestoreFile: previous.file,
    summary: {
      totalEvents: args.schema.events.length,
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
      unchanged: diff.unchanged,
    },
    events: diff.events,
  };

  fs.appendFileSync(auditFile, `${JSON.stringify(entry)}\n`);

  return { auditFile, restoreFile, entry };
}
