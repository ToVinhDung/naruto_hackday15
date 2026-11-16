import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBaseline } from '../src/engine/baselineManager.mjs';
import {
  fetch_deliverable_diff,
  run_sandbox_verification,
  evaluate_with_rule_engine,
  anchor_proof_onchain,
  executeAgentTool
} from '../src/tools/agentTools.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'escrow-agent-tools-'));

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Tool 1 (fetch_deliverable_diff): từ chối URL không phải GitHub và trả về cấu trúc chuẩn', async () => {
  const invalid = await fetch_deliverable_diff({ repoUrl: 'https://example.com/fake', commitHash: 'HEAD' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.tool, 'fetch_deliverable_diff');
  assert.deepEqual(invalid.changedFiles, []);
});

test('Tool 2 (run_sandbox_verification): xuất exitCode, unit_test_pass_rate, api_latency_ms và tạo file log', async () => {
  const res = await run_sandbox_verification({
    repoUrl: path.join(tmpDir, 'missing-repo'),
    commitHash: 'HEAD',
    testCommand: 'node --test',
    timeoutMs: 3000
  });
  assert.equal(res.tool, 'run_sandbox_verification');
  assert.equal(res.networkAccess, false);
  assert.equal(res.exitCode, 1);
  assert.equal(res.unit_test_pass_rate, 0);
  assert.ok(typeof res.api_latency_ms === 'number');
  assert.ok(fs.existsSync(res.logFile));
  fs.rmSync(res.logFile, { force: true });
});

test('Tool 3 (evaluate_with_rule_engine): gọi evaluateSubmission() thuần túy, phát hiện BLOCK_AND_FLAG và xuất testReportHash', () => {
  const baseline = createBaseline({
    agreementId: 'AGR-TOOL-1',
    milestoneId: 'MS-1',
    baseDir: tmpDir,
    scopeConstraints: { forbiddenPaths: ['.env', 'src/contracts/MilestoneEscrow.sol'] },
    acceptanceCriteria: [
      { id: 'OBJ-1', type: 'DETERMINISTIC', metric: 'unit_test_pass_rate', operator: '==', expectedValue: 100, weight: 70 },
      { id: 'OBJ-2', type: 'DETERMINISTIC', metric: 'api_latency_ms', operator: '<=', expectedValue: 250, weight: 30 }
    ]
  });

  const blocked = evaluate_with_rule_engine({
    baselineId: 'AGR-TOOL-1__MS-1',
    baseDir: tmpDir,
    changedFiles: ['.env'],
    sandboxMetrics: { unit_test_pass_rate: 100, api_latency_ms: 120 }
  });
  assert.equal(blocked.tool, 'evaluate_with_rule_engine');
  assert.equal(blocked.pureDeterministic, true);
  assert.equal(blocked.llmUsed, false);
  assert.equal(blocked.recommendation, 'BLOCK_AND_FLAG');
  assert.match(blocked.testReportHash, /^[a-f0-9]{64}$/);

  const passed = evaluate_with_rule_engine({
    baseline,
    changedFiles: ['src/api/payment.mjs'],
    sandboxMetrics: { unit_test_pass_rate: 100, api_latency_ms: 120 }
  });
  assert.equal(passed.deterministicScore, 100);
  assert.equal(passed.recommendation, 'AUTO_RECOMMEND_RELEASE');
});

test('Tool 4 (anchor_proof_onchain): chỉ ghi ProofRegistry.recordVerification() trên Avalanche Fuji, không có quyền giải ngân MilestoneEscrow', async () => {
  const anchored = await executeAgentTool('anchor_proof_onchain', {
    agreementId: 'AGR-TOOL-1',
    milestoneId: 'MS-1',
    deliverableHash: '0x' + 'a'.repeat(64),
    testReportHash: 'b'.repeat(64),
    deterministicScore: 100
  });

  assert.equal(anchored.tool, 'anchor_proof_onchain');
  assert.equal(anchored.allowedContract, 'ProofRegistry.sol');
  assert.equal(anchored.canReleaseFunds, false);
  assert.ok(anchored.payload.method.startsWith('recordVerification('));
  assert.match(anchored.txHash, /^0x[a-f0-9]{64}$/);
  assert.match(anchored.relaySignature, /^0x[a-f0-9]{64}$/);
});

