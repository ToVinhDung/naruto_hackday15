import fs from 'node:fs';
import path from 'node:path';
import { enforceAntiHallucination } from './schemaGuard.mjs';

const DEFAULT_BASELINES_DIR = path.resolve(process.cwd(), 'data', 'baselines');
const ALLOWED_OPERATORS = new Set(['==', '>=', '<=', '>', '<']);

export const SEED_HISTORICAL_BASELINES = [
  {
    agreementId: 'HIST-API-01',
    milestoneId: 'MS-1',
    title: 'Xây dựng API Thanh toán VietQR & Tích hợp Webhook Xác thực',
    cleanCompletion: true,
    disputed: false,
    tags: ['api', 'thanh toan', 'payment', 'webhook', 'vietqr', 'backend', 'toc do', 'bao mat'],
    acceptanceCriteria: [
      { id: 'OBJ-01', type: 'DETERMINISTIC', metric: 'api_latency_ms', operator: '<=', expectedValue: 200, weight: 40 },
      { id: 'OBJ-02', type: 'DETERMINISTIC', metric: 'unit_test_pass_rate', operator: '==', expectedValue: 100, weight: 35 },
      { id: 'OBJ-03', type: 'DETERMINISTIC', metric: 'security_critical_issues', operator: '==', expectedValue: 0, weight: 25 }
    ]
  },
  {
    agreementId: 'HIST-UI-02',
    milestoneId: 'MS-1',
    title: 'Thiết kế Giao diện White UI Dashboard & Tối ưu Trải nghiệm Người dùng',
    cleanCompletion: true,
    disputed: false,
    tags: ['ui', 'ux', 'giao dien', 'dashboard', 'frontend', 'web', 'dep', 'muot', 'figma'],
    acceptanceCriteria: [
      { id: 'OBJ-01', type: 'DETERMINISTIC', metric: 'unit_test_pass_rate', operator: '==', expectedValue: 100, weight: 45 },
      { id: 'OBJ-02', type: 'DETERMINISTIC', metric: 'api_latency_ms', operator: '<=', expectedValue: 250, weight: 30 },
      { id: 'SUB-01', type: 'SUBJECTIVE', description: 'Bố cục nền trắng cân đối, dễ nhìn trên Desktop & Mobile', requiresHitl: true, weight: 25 }
    ]
  },
  {
    agreementId: 'HIST-SC-03',
    milestoneId: 'MS-1',
    title: 'Phát triển Smart Contract Escrow Vault Multi-Sig trên Avalanche',
    cleanCompletion: true,
    disputed: false,
    tags: ['smart contract', 'escrow', 'vault', 'solidity', 'avalanche', 'blockchain', 'bao mat', 'code'],
    acceptanceCriteria: [
      { id: 'OBJ-01', type: 'DETERMINISTIC', metric: 'security_critical_issues', operator: '==', expectedValue: 0, weight: 50 },
      { id: 'OBJ-02', type: 'DETERMINISTIC', metric: 'unit_test_pass_rate', operator: '==', expectedValue: 100, weight: 50 }
    ]
  }
];

function foldText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Đọc danh sách historical baselines từ `data/baselines/` kết hợp kho mẫu chuẩn đã hoàn thành không tranh chấp.
 */
export function loadHistoricalBaselines(baseDir = DEFAULT_BASELINES_DIR) {
  const loaded = [];
  if (fs.existsSync(baseDir)) {
    for (const file of fs.readdirSync(baseDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(baseDir, file), 'utf8'));
        if (parsed && Array.isArray(parsed.acceptanceCriteria)) {
          loaded.push({
            cleanCompletion: parsed.disputed !== true,
            disputed: Boolean(parsed.disputed),
            ...parsed
          });
        }
      } catch {
        // Bỏ qua file lỗi định dạng
      }
    }
  }
  return [...loaded, ...SEED_HISTORICAL_BASELINES];
}

/**
 * Chấm điểm & chọn Top 3 Historical Baselines theo Similarity Score + Clean Completion.
 */
export function rankHistoricalBaselines(contractTitle = '', historicalBaselines = []) {
  const pool = Array.isArray(historicalBaselines) && historicalBaselines.length > 0
    ? historicalBaselines
    : SEED_HISTORICAL_BASELINES;
  const titleTokens = foldText(contractTitle)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);

  return pool
    .map((b) => {
      const targetText = foldText(`${b.title || ''} ${b.agreementId || ''} ${(b.tags || []).join(' ')}`);
      const matchedTokens = titleTokens.filter((tok) => targetText.includes(tok));
      const similarityScore = titleTokens.length > 0 ? matchedTokens.length / titleTokens.length : 0.2;
      const cleanBonus = b.disputed ? -0.5 : (b.cleanCompletion !== false ? 0.35 : 0);
      return {
        baseline: b,
        similarityScore: Math.round(similarityScore * 100) / 100,
        totalRankScore: Math.round((similarityScore + cleanBonus) * 100) / 100
      };
    })
    .filter((item) => !item.baseline.disputed)
    .sort((a, b) => b.totalRankScore - a.totalRankScore)
    .slice(0, 3);
}

function findInheritedCriterion(topRanked, targetMetric) {
  for (const { baseline } of topRanked) {
    const found = (baseline.acceptanceCriteria || []).find(
      (c) => c.type === 'DETERMINISTIC' && c.metric === targetMetric
    );
    if (found) return found;
  }
  return null;
}

function classifySingleCriterion(rawText, index, contractTitle, topRanked) {
  const originalText = String(rawText || '').trim();
  const folded = foldText(originalText);

  // 1. Nhóm cảm quan / chủ quan (giao diện đẹp, dễ nhìn, thẩm mỹ, màu sắc, văn phong)
  if (/dep|de nhin|tham my|giao dien|mau sac|bo cuc|van phong|cam quan|hop mat|than thien/.test(folded) && !/\d+\s*(ms|%|px)/.test(folded)) {
    return {
      id: `SUB-0${index + 1}`,
      originalText,
      type: 'SUBJECTIVE',
      metric: null,
      operator: null,
      expectedValue: null,
      requiresHitl: true,
      recommendedStandard: false,
      rawWeightHint: 20,
      clarifiedDescription: `Đánh giá cảm quan cho "${contractTitle}": ${originalText} (cần Client nghiệm thu trực tiếp trên giao diện thực tế - HITL).`
    };
  }

  // 2. Nhóm tốc độ / hiệu năng (chạy nhanh, mượt, tốc độ, latency, phản hồi)
  if (/nhanh|toc do|muot|latency|phan hoi|p95|performance|ms\b/.test(folded)) {
    const inherited = findInheritedCriterion(topRanked, 'api_latency_ms');
    const expectedValue = inherited?.expectedValue ?? 250;
    const operator = ALLOWED_OPERATORS.has(inherited?.operator) ? inherited.operator : '<=';
    return {
      id: `OBJ-0${index + 1}`,
      originalText,
      type: 'DETERMINISTIC',
      metric: 'api_latency_ms',
      operator,
      expectedValue,
      requiresHitl: false,
      recommendedStandard: true,
      inheritedFrom: inherited ? topRanked[0]?.baseline?.agreementId || null : null,
      rawWeightHint: 35,
      clarifiedDescription: `Hiệu năng phản hồi của "${contractTitle}" đạt ngưỡng api_latency_ms ${operator} ${expectedValue}ms khi kiểm thử tự động trong Sandbox.`
    };
  }

  // 3. Nhóm bảo mật / an toàn (bảo mật, lỗ hổng, input âm, an toàn)
  if (/bao mat|an toan|security|lo hong|audit|input am|injection|xss/.test(folded)) {
    const inherited = findInheritedCriterion(topRanked, 'security_critical_issues');
    const expectedValue = inherited?.expectedValue ?? 0;
    const operator = ALLOWED_OPERATORS.has(inherited?.operator) ? inherited.operator : '==';
    return {
      id: `OBJ-0${index + 1}`,
      originalText,
      type: 'DETERMINISTIC',
      metric: 'security_critical_issues',
      operator,
      expectedValue,
      requiresHitl: false,
      recommendedStandard: true,
      inheritedFrom: inherited ? topRanked[0]?.baseline?.agreementId || null : null,
      rawWeightHint: 35,
      clarifiedDescription: `Kiểm định an toàn cho "${contractTitle}": số lỗ hổng nghiêm trọng security_critical_issues ${operator} ${expectedValue}.`
    };
  }

  // 4. Nhóm không lỗi / chạy được / unit test (mặc định cho tiêu chí kỹ thuật)
  const inherited = findInheritedCriterion(topRanked, 'unit_test_pass_rate');
  const expectedValue = inherited?.expectedValue ?? 100;
  const operator = ALLOWED_OPERATORS.has(inherited?.operator) ? inherited.operator : '==';
  return {
    id: `OBJ-0${index + 1}`,
    originalText,
    type: 'DETERMINISTIC',
    metric: 'unit_test_pass_rate',
    operator,
    expectedValue,
    requiresHitl: false,
    recommendedStandard: true,
    inheritedFrom: inherited ? topRanked[0]?.baseline?.agreementId || null : null,
    rawWeightHint: 40,
    clarifiedDescription: ` Toàn bộ bộ kiểm thử tự động cho "${contractTitle}" (${originalText}) phải đạt tỷ lệ qua bài unit_test_pass_rate ${operator} ${expectedValue}%.`.trim()
  };
}

function normalizeWeightsTo100(items) {
  if (items.length === 0) return [];
  const totalHint = items.reduce((s, it) => s + (it.rawWeightHint || 25), 0) || 100;
  let allocated = 0;

  return items.map((item, idx) => {
    const { rawWeightHint, ...rest } = item;
    if (idx === items.length - 1) {
      return { ...rest, weight: Math.max(1, 100 - allocated) };
    }
    const w = Math.max(1, Math.round(((rawWeightHint || 25) / totalHint) * 100));
    allocated += w;
    return { ...rest, weight: w };
  });
}

async function enhanceDescriptionsWithGemini(contractTitle, items) {
  const apiKey = typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '';
  if (!apiKey || items.length === 0) return null;

  const primaryModel = (typeof process !== 'undefined' ? process.env.GEMINI_MODEL : '') || 'gemini-3.5-flash';
  const modelsToTry = [
    ...new Set([
      primaryModel,
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.7-flash',
      'gemini-3.8-flash',
      'gemini-flash-latest',
      'gemini-flash-lite-latest'
    ])
  ];

  const prompt = [
    'Bạn là Chuyên gia Pháp lý & Kỹ thuật Smart Escrow. Hãy viết lại câu "clarifiedDescription" bằng tiếng Việt thật tự nhiên, chặt chẽ pháp lý và bám sát hợp đồng cho từng tiêu chí dưới đây.',
    `Tên hợp đồng: "${contractTitle}"`,
    `Danh sách tiêu chí: ${JSON.stringify(items.map((i) => ({ id: i.id, originalText: i.originalText, type: i.type, metric: i.metric, operator: i.operator, expectedValue: i.expectedValue, weight: i.weight })))}`,
    'Trả về đúng JSON object: { "descriptions": [ { "id": string, "clarifiedDescription": string } ] }'
  ].join('\n');

  for (const model of modelsToTry) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
        })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;
      const parsed = JSON.parse(rawText);
      if (!Array.isArray(parsed?.descriptions)) continue;
      return new Map(
        parsed.descriptions
          .filter((d) => d && d.id && d.clarifiedDescription)
          .map((d) => [String(d.id), String(d.clarifiedDescription).trim()])
      );
    } catch {
      // Thử model tiếp theo
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Chuẩn hóa danh sách tiêu chí nghiệm thu mơ hồ dựa trên tên hợp đồng và kho Historical Baselines (RAG + Rule + LLM).
 * Tổng trọng số (weight) luôn bằng đúng 100.
 */
export async function refineVagueCriteria(
  contractTitle = '',
  rawCriteriaList = [],
  historicalBaselines = [],
  options = {}
) {
  const title = String(contractTitle || 'Hợp đồng phát triển phần mềm').trim();
  const parsedList = (Array.isArray(rawCriteriaList) ? rawCriteriaList : String(rawCriteriaList || '').split(/\r?\n|;|,/))
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  const effectiveInput = parsedList.length > 0
    ? parsedList
    : ['API chạy nhanh', 'Code không lỗi', 'Giao diện đẹp'];

  const topRanked = rankHistoricalBaselines(title, historicalBaselines);
  const classified = effectiveInput.map((raw, idx) => classifySingleCriterion(raw, idx, title, topRanked));
  const weighted = normalizeWeightsTo100(classified);

  let llmMap = null;
  if (options.useLlm !== false) {
    llmMap = await enhanceDescriptionsWithGemini(title, weighted);
  }

  const mergedCriteria = weighted.map((item) => ({
    ...item,
    clarifiedDescription: llmMap?.get(item.id) || item.clarifiedDescription
  }));

  const criteria = enforceAntiHallucination(mergedCriteria, options.knownFiles || []);
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);

  return {
    contractTitle: title,
    totalWeight,
    llmEnhanced: Boolean(llmMap && llmMap.size > 0),
    matchedBaselines: topRanked.map((r) => ({
      agreementId: r.baseline.agreementId,
      title: r.baseline.title || r.baseline.agreementId,
      similarityScore: r.similarityScore,
      totalRankScore: r.totalRankScore
    })),
    criteria
  };
}
