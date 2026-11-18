import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  toBytes32,
  toNumericMilestoneId,
  buildSnowtraceTxUrl,
  anchorProofOnFuji
} from '../src/blockchain/fujiBridge.mjs';

test('1. EscrowCore.sol có đầy đủ WorkAgreement, MilestoneEscrow, ProofRecord, recordVerification và ProofAnchored', () => {
  const sol = fs.readFileSync('contracts/EscrowCore.sol', 'utf8');
  assert.match(sol, /pragma solidity \^0\.8\.20;/);
  assert.match(sol, /struct WorkAgreement/);
  assert.match(sol, /struct MilestoneEscrow/);
  assert.match(sol, /struct ProofRecord/);
  assert.match(sol, /function fundMilestone\(/);
  assert.match(sol, /function releaseMilestone\(/);
  assert.match(sol, /AgentRelay cannot release funds/);
  assert.match(sol, /function recordVerification\(/);
  assert.match(sol, /event ProofAnchored\(uint256 indexed milestoneId, bytes32 testReportHash, uint8 score\)/);
});

test('2. hardhat.config.cjs & scripts/deployFuji.cjs cấu hình đúng Avalanche Fuji (43113) và xuất fuji-deployment.json', () => {
  const hh = fs.readFileSync('hardhat.config.cjs', 'utf8');
  assert.match(hh, /https:\/\/api\.avax-test\.network\/ext\/bc\/C\/rpc/);
  assert.match(hh, /chainId:\s*43113/);

  const deploy = fs.readFileSync('scripts/deployFuji.cjs', 'utf8');
  assert.match(deploy, /EscrowCore/);
  assert.match(deploy, /fuji-deployment\.json/);
});

test('3. fujiBridge.mjs chuẩn hóa bytes32, Snowtrace URL và xử lý an toàn khi chưa deploy contract', async () => {
  const b1 = toBytes32('sha256:9f4d2c1b8a7e3f609a7f3c2b');
  assert.match(b1, /^0x[a-f0-9]{64}$/);

  const exactHex = '0x' + 'ab'.repeat(32);
  assert.equal(toBytes32(exactHex), exactHex);

  const numId = toNumericMilestoneId('ESC-101');
  assert.equal(typeof numId, 'bigint');
  assert.ok(numId > 0n);

  const url = buildSnowtraceTxUrl('0x1234567890abcdef');
  assert.equal(url, 'https://testnet.snowtrace.io/tx/0x1234567890abcdef');

  const res = await anchorProofOnFuji({
    milestoneId: 'ESC-101',
    deliverableHash: 'abc',
    testReportHash: 'def',
    score: 100,
    deploymentPath: path.join(process.cwd(), 'data', 'non-existent-deployment.json')
  });
  assert.equal(res.onChain, false);
  assert.equal(res.chainId, 43113);
});

