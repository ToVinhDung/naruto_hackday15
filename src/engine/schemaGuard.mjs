export const ALLOWED_METRICS = Object.freeze([
  'unit_test_pass_rate',
  'build_exit_code',
  'api_latency_ms',
  'code_coverage',
  'security_critical_issues',
  'delivered_docs_valid'
]);

export const ALLOWED_OPERATORS = Object.freeze([
  '==',
  '>=',
  '<=',
  '>',
  '<',
  'CONTAINS',
  'NOT_STARTS_WITH'
]);

const ALLOWED_METRICS_SET = new Set(ALLOWED_METRICS);
const ALLOWED_OPERATORS_SET = new Set(ALLOWED_OPERATORS);

function normalizeFilePath(filePath) {
  return String(filePath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

function filterKnownFiles(fileRefs, knownSet) {
  if (!Array.isArray(fileRefs) || fileRefs.length === 0) {
    return { validFiles: [], removedFiles: [] };
  }
  if (knownSet.size === 0) {
    return { validFiles: fileRefs.map(normalizeFilePath).filter(Boolean), removedFiles: [] };
  }
  const validFiles = [];
  const removedFiles = [];
  for (const rawFile of fileRefs) {
    const norm = normalizeFilePath(rawFile);
    if (!norm) continue;
    if (knownSet.has(norm)) {
      validFiles.push(norm);
    } else {
      removedFiles.push(norm);
    }
  }
  return { validFiles, removedFiles };
}

function stripUnknownFilesFromText(text, knownSet) {
  if (!text || knownSet.size === 0) return { cleanedText: text, removedFromText: [] };
  const removedFromText = [];
  const fileTokenRegex = /\b(?:src|lib|app|tests?|config|contracts|docs|scripts|api)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+\b/g;
  const cleanedText = String(text).replace(fileTokenRegex, (matchedPath) => {
    const norm = normalizeFilePath(matchedPath);
    if (knownSet.has(norm)) return matchedPath;
    removedFromText.push(norm);
    return '[removed-nonexistent-file]';
  });
  return { cleanedText, removedFromText };
}

function normalizeWeightsTo100(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const rawWeights = items.map((item) => {
    const w = Number(item?.weight);
    return Number.isFinite(w) && w > 0 ? w : 1;
  });
  const totalRaw = rawWeights.reduce((sum, w) => sum + w, 0) || items.length;

  let allocated = 0;
  return items.map((item, idx) => {
    if (idx === items.length - 1) {
      return {
        ...item,
        weight: Math.max(1, 100 - allocated)
      };
    }
    const normalized = Math.max(1, Math.round((rawWeights[idx] / totalRaw) * 100));
    // Đảm bảo vẫn còn tối thiểu 1 đơn vị weight cho mỗi phần tử phía sau
    const maxAllowed = 100 - allocated - (items.length - 1 - idx);
    const bounded = Math.min(normalized, Math.max(1, maxAllowed));
    allocated += bounded;
    return {
      ...item,
      weight: bounded
    };
  });
}

/**
 * Lớp bảo vệ chống ảo giác (Anti-Hallucination & Schema Guard):
 * - Hạ cấp tiêu chí DETERMINISTIC có metric ngoài ALLOWED_METRICS hoặc operator ngoài ALLOWED_OPERATORS về SUBJECTIVE (HITL).
 * - Chuẩn hóa tổng weight luôn bằng đúng 100.
 * - Đối chiếu và loại bỏ các tham chiếu file không tồn tại trong knownFiles từ GitHub.
 */
export function enforceAntiHallucination(criteriaList = [], knownFiles = []) {
  if (!Array.isArray(criteriaList) || criteriaList.length === 0) {
    return [];
  }

  const knownSet = new Set(
    (Array.isArray(knownFiles) ? knownFiles : []).map(normalizeFilePath).filter(Boolean)
  );

  const sanitized = criteriaList.map((raw, index) => {
    const item = { ...raw };
    const id = String(item.id || `CRIT-0${index + 1}`).trim();
    const rawType = String(item.type || 'SUBJECTIVE').toUpperCase();
    const warnings = Array.isArray(item.warnings) ? [...item.warnings] : [];

    // 1. Kiểm tra & lọc tham chiếu file ảo giác so với knownFiles từ GitHub
    const inputFiles = item.referencedFiles || item.files || [];
    const { validFiles, removedFiles } = filterKnownFiles(inputFiles, knownSet);
    const descSource = item.clarifiedDescription || item.description || item.originalText || '';
    const { cleanedText, removedFromText } = stripUnknownFilesFromText(descSource, knownSet);
    const allRemovedFiles = [...new Set([...removedFiles, ...removedFromText])];

    if (allRemovedFiles.length > 0) {
      warnings.push(`Đã loại bỏ tham chiếu file không tồn tại trên GitHub: ${allRemovedFiles.join(', ')}`);
    }

    if (Array.isArray(item.referencedFiles) || Array.isArray(item.files) || allRemovedFiles.length > 0) {
      item.referencedFiles = validFiles;
      if (Array.isArray(item.files)) item.files = validFiles;
      item.removedFileRefs = allRemovedFiles;
    }

    if (item.clarifiedDescription) item.clarifiedDescription = cleanedText;
    if (item.description) item.description = cleanedText;

    // 2. Kiểm tra metric và operator của tiêu chí DETERMINISTIC
    if (rawType === 'DETERMINISTIC') {
      const metric = String(item.metric || '').trim();
      const operator = String(item.operator || '==').trim();
      const isMetricValid = ALLOWED_METRICS_SET.has(metric);
      const isOperatorValid = ALLOWED_OPERATORS_SET.has(operator);

      if (!isMetricValid || !isOperatorValid) {
        const reason = !isMetricValid
          ? `Metric "${metric || 'EMPTY'}" không nằm trong ALLOWED_METRICS`
          : `Operator "${operator}" không nằm trong ALLOWED_OPERATORS`;
        const warningMsg = `[Anti-Hallucination Guard] ${reason}; tự động hạ cấp tiêu chí "${id}" sang SUBJECTIVE (HITL).`;
        warnings.push(warningMsg);

        const fallbackDesc =
          cleanedText ||
          `Kiểm tra thủ công (HITL) cho tiêu chí "${id}" (hạ cấp từ metric ${metric || 'unknown'}).`;

        return {
          ...item,
          id,
          type: 'SUBJECTIVE',
          metric: null,
          operator: null,
          expectedValue: null,
          requiresHitl: true,
          downgradedByGuard: true,
          warning: warningMsg,
          warnings,
          description: fallbackDesc,
          clarifiedDescription: item.clarifiedDescription ? cleanedText : fallbackDesc
        };
      }

      return {
        ...item,
        id,
        type: 'DETERMINISTIC',
        metric,
        operator,
        requiresHitl: false,
        downgradedByGuard: false,
        ...(warnings.length > 0 ? { warning: warnings.join(' | '), warnings } : {})
      };
    }

    // 3. Tiêu chí SUBJECTIVE giữ nguyên requiresHitl: true
    return {
      ...item,
      id,
      type: 'SUBJECTIVE',
      metric: null,
      operator: null,
      expectedValue: null,
      requiresHitl: true,
      downgradedByGuard: Boolean(item.downgradedByGuard),
      description: cleanedText || item.originalText || `Đánh giá cảm quan (HITL) cho ${id}`,
      ...(warnings.length > 0 ? { warning: warnings.join(' | '), warnings } : {})
    };
  });

  return normalizeWeightsTo100(sanitized);
}

