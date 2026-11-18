import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ALLOWED_OPERATORS as GUARD_OPERATORS, enforceAntiHallucination } from './schemaGuard.mjs';

const ALLOWED_OPERATORS = new Set(GUARD_OPERATORS);
const DEFAULT_BASELINES_DIR = path.resolve(process.cwd(), 'data', 'baselines');

/**
 * Compute a deterministic SHA-256 hex digest for any JSON-serializable value.
 */
export function computeSha256(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

function sanitizeSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function normalizeCriterion(criterion, index) {
  if (!criterion || typeof criterion !== 'object') {
    throw new TypeError(`Invalid criterion at index ${index}`);
  }
  const id = String(criterion.id || `CRIT-${index + 1}`).trim();
  const type = String(criterion.type || '').toUpperCase();
  const weight = Number.isFinite(Number(criterion.weight)) ? Number(criterion.weight) : 1;

  if (type === 'DETERMINISTIC') {
    const operator = String(criterion.operator || '==').trim();
    if (!ALLOWED_OPERATORS.has(operator)) {
      throw new Error(`Unsupported operator "${operator}" in criterion "${id}"`);
    }
    if (!criterion.metric) {
      throw new Error(`Deterministic criterion "${id}" requires a metric name`);
    }
    return {
      id,
      type: 'DETERMINISTIC',
      metric: String(criterion.metric).trim(),
      operator,
      expectedValue: criterion.expectedValue,
      weight,
      ...(criterion.is_critical || criterion.isCritical ? { is_critical: true } : {})
    };
  }

  if (type === 'SUBJECTIVE') {
    return {
      id,
      type: 'SUBJECTIVE',
      description: String(criterion.description || criterion.clarifiedDescription || '').trim(),
      requiresHitl: true,
      weight,
      ...(criterion.is_critical || criterion.isCritical ? { is_critical: true } : {}),
      ...(criterion.downgradedByGuard ? { downgradedByGuard: true, warning: criterion.warning } : {}),
      ...(Array.isArray(criterion.referencedFiles) ? { referencedFiles: criterion.referencedFiles } : {}),
      ...(Array.isArray(criterion.removedFileRefs) && criterion.removedFileRefs.length > 0
        ? { removedFileRefs: criterion.removedFileRefs }
        : {})
    };
  }

  throw new Error(`Unknown criterion type "${criterion.type}" for "${id}"`);
}

/**
 * Normalize agreement milestone criteria, freeze the baseline, compute its SHA-256 hash,
 * and persist an immutable JSON snapshot under `data/baselines/`.
 */
export function createBaseline({
  agreementId,
  milestoneId,
  scopeConstraints = {},
  acceptanceCriteria = [],
  knownFiles = [],
  persist = true,
  baseDir = DEFAULT_BASELINES_DIR
}) {
  if (!agreementId || !milestoneId) {
    throw new Error('agreementId and milestoneId are required to create a baseline');
  }
  if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0) {
    throw new Error('acceptanceCriteria must be a non-empty array');
  }

  const guardedCriteria = enforceAntiHallucination(acceptanceCriteria, knownFiles);
  const normalizedCriteria = guardedCriteria.map((item, idx) => normalizeCriterion(item, idx));
  const normalizedScope = {
    allowedPaths: Array.isArray(scopeConstraints.allowedPaths)
      ? scopeConstraints.allowedPaths.map((p) => String(p).trim()).filter(Boolean)
      : [],
    forbiddenPaths: Array.isArray(scopeConstraints.forbiddenPaths)
      ? scopeConstraints.forbiddenPaths.map((p) => String(p).trim()).filter(Boolean)
      : []
  };

  const canonicalPayload = {
    schemaVersion: '1.0.0',
    agreementId: String(agreementId).trim(),
    milestoneId: String(milestoneId).trim(),
    frozen: true,
    scopeConstraints: normalizedScope,
    acceptanceCriteria: normalizedCriteria
  };

  const baselineHash = computeSha256(canonicalPayload);
  const baseline = deepFreeze({
    ...canonicalPayload,
    baselineHash,
    createdAt: new Date().toISOString()
  });

  if (persist) {
    fs.mkdirSync(baseDir, { recursive: true });
    const fileName = `${sanitizeSegment(baseline.agreementId)}__${sanitizeSegment(baseline.milestoneId)}.json`;
    const filePath = path.join(baseDir, fileName);

    if (fs.existsSync(filePath)) {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (existing?.frozen) {
        throw new Error(`Baseline "${fileName}" is already frozen and cannot be overwritten`);
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(baseline, null, 2), 'utf8');
  }

  return baseline;
}

/**
 * Load a persisted baseline snapshot from `data/baselines/`.
 */
export function loadBaseline(agreementId, milestoneId, { baseDir = DEFAULT_BASELINES_DIR } = {}) {
  const fileName = `${sanitizeSegment(agreementId)}__${sanitizeSegment(milestoneId)}.json`;
  const filePath = path.join(baseDir, fileName);
  if (!fs.existsSync(filePath)) return null;
  return deepFreeze(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

