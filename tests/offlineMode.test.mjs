import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPreviewServer, isOfflineMode } from '../src/server.mjs';
import { anchorProofOnFuji } from '../src/blockchain/fujiBridge.mjs';
import { fetchGitHubCommitDetails, runSandboxTests } from '../src/tools/githubVerifier.mjs';

test('0. Standard Mode: isOfflineMode() chỉ trả về true khi OFFLINE_MODE=true được truyền tường minh', () => {
  const prevOffline = process.env.OFFLINE_MODE;
  delete process.env.OFFLINE_MODE;
  assert.equal(isOfflineMode(), false);
  process.env.OFFLINE_MODE = 'false';
  assert.equal(isOfflineMode(), false);
  process.env.OFFLINE_MODE = 'true';
  assert.equal(isOfflineMode(), true);
  if (prevOffline === undefined) delete process.env.OFFLINE_MODE;
  else process.env.OFFLINE_MODE = prevOffline;
});

test('1. OFFLINE_MODE=true: /api/health & /api/config trả về offlineMode: true và mở khóa Arbiter với arbiter2026', async () => {
  const prevOffline = process.env.OFFLINE_MODE;
  process.env.OFFLINE_MODE = 'true';
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
    assert.equal(health.status, 'ok');
    assert.equal(health.offlineMode, true);
    assert.equal(health.arbiterOfflineHint, 'arbiter2026');

    const config = await fetch(`${baseUrl}/api/config`).then((r) => r.json());
    assert.equal(config.offlineMode, true);

    const badAuth = await fetch(`${baseUrl}/api/auth/arbiter`, {
      method: 'POST',
      headers: { 'x-arbiter-token': '123456' }
    });
    assert.equal(badAuth.status, 401);

    const okAuth = await fetch(`${baseUrl}/api/auth/arbiter`, {
      method: 'POST',
      headers: { 'x-arbiter-token': 'arbiter2026' }
    }).then((r) => r.json());
    assert.equal(okAuth.ok, true);
    assert.equal(okAuth.offlineMode, true);
  } finally {
    server.close();
    if (prevOffline === undefined) delete process.env.OFFLINE_MODE;
    else process.env.OFFLINE_MODE = prevOffline;
  }
});

test('2. OFFLINE_MODE=true: GitHub Verifier & Fuji Bridge chạy cục bộ không gọi mạng ngoài và sinh SHA-256 hợp lệ', async () => {
  const prevOffline = process.env.OFFLINE_MODE;
  process.env.OFFLINE_MODE = 'true';

  try {
    const ghDetails = await fetchGitHubCommitDetails({ owner: 'demo', repo: 'app', commitSha: 'HEAD' });
    assert.equal(ghDetails.ok, true);
    assert.equal(ghDetails.offlineMode, true);
    assert.ok(Array.isArray(ghDetails.changedFiles) && ghDetails.changedFiles.length > 0);

    const sandboxRes = await runSandboxTests({ repoUrl: 'https://github.com/demo/app' });
    assert.equal(sandboxRes.ok, true);
    assert.equal(sandboxRes.offlineMode, true);
    assert.equal(sandboxRes.metrics.unit_test_pass_rate, 100);

    const proofRes = await anchorProofOnFuji({
      milestoneId: 'MS-1',
      deliverableHash: 'abc123',
      testReportHash: 'def456',
      score: 100
    });
    assert.equal(proofRes.onChain, false);
    assert.equal(proofRes.offlineMode, true);
    assert.match(proofRes.proofSha256, /^0x[a-f0-9]{64}$/);

    const html = fs.readFileSync('src/index.html', 'utf8');
    const appJs = fs.readFileSync('src/app.js', 'utf8');
    assert.ok(html.includes('Offline Demo Mode (No API Key Required)'));
    assert.ok(html.includes('arbiter2026'));
    assert.ok(appJs.includes('offlineModeBadgeEl'));
  } finally {
    if (prevOffline === undefined) delete process.env.OFFLINE_MODE;
    else process.env.OFFLINE_MODE = prevOffline;
  }
});

test('3. Full 6-Flow Verification trong OFFLINE_MODE=true và không chạm vào data/db.json gốc', async () => {
  const dbPath = 'data/db.json';
  const dbBefore = fs.existsSync(dbPath) ? fs.readFileSync(dbPath, 'utf8') : null;
  const prevOffline = process.env.OFFLINE_MODE;
  process.env.OFFLINE_MODE = 'true';

  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Luồng 1: Seed state trong RAM + đăng nhập Arbiter với arbiter2026
    const stateRes = await fetch(`${baseUrl}/api/state?role=client`).then((r) => r.json());
    assert.ok(Array.isArray(stateRes.contracts) && stateRes.contracts.length >= 3);
    const authRes = await fetch(`${baseUrl}/api/auth/arbiter`, {
      method: 'POST',
      headers: { 'x-arbiter-token': 'arbiter2026' }
    }).then((r) => r.json());
    assert.equal(authRes.ok, true);

    // Luồng 2: Tạo hợp đồng -> Freelancer nộp -> Giải ngân COMPLETED
    const created = await fetch(`${baseUrl}/api/contracts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({
        title: 'Xây dựng Landing Page Offline Test',
        freelancer: 'dev-offline',
        amount: 2000000,
        acceptanceCriteria: 'Responsive UI và Pass 100% unit tests'
      })
    }).then((r) => r.json());
    assert.equal(created.ok, true);
    const newId = created.contract.id;

    const delivered = await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(newId)}/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'freelancer' },
      body: JSON.stringify({
        role: 'freelancer',
        repoUrl: 'https://github.com/demo/landing-page',
        commitHash: 'abc1234',
        deliveryNotes: 'Hoàn tất bàn giao'
      })
    }).then((r) => r.json());
    assert.equal(delivered.ok, true);
    assert.equal(delivered.contract.signatures.freelancer, true);

    const released = await fetch(`${baseUrl}/api/milestones/${encodeURIComponent(newId)}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({ role: 'client', buyerSigned: true, percent: 100 })
    }).then((r) => r.json());
    assert.equal(released.ok, true);
    assert.equal(released.contract.status, 'COMPLETED');

    // Luồng 3: Yêu cầu sửa -> reset chữ ký Seller về false
    const created2 = await fetch(`${baseUrl}/api/contracts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({
        title: 'API Thanh toán Demo Revision',
        freelancer: 'dev-rev',
        amount: 3000000,
        acceptanceCriteria: 'API latency < 200ms'
      })
    }).then((r) => r.json());
    const revId = created2.contract.id;

    await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(revId)}/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'freelancer' },
      body: JSON.stringify({ role: 'freelancer', repoUrl: 'https://github.com/demo/api', commitHash: 'def5678' })
    });
    const revRes = await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(revId)}/request-revision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({ role: 'client', reason: 'Bổ sung xử lý lỗi 400' })
    }).then((r) => r.json());
    assert.equal(revRes.ok, true);
    assert.equal(revRes.contract.status, 'REVISION_REQUESTED');
    assert.equal(revRes.contract.signatures.freelancer, false);

    // Luồng 4, 5, 6: Đóng băng -> Trọng tài chia tỷ lệ (lệch AI phải có giải trình >= 20 ký tự) -> Khiếu nại 1/1 -> Tái thẩm -> 2 bên đồng ý -> COMPLETED
    await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(revId)}/dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({
        role: 'client',
        reason: 'Chậm tiến độ',
        evidences: [{ id: 'EV-OFF-1', fileName: 'log.txt', uploadedBy: 'CLIENT' }]
      })
    });

    const badResolve = await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(revId)}/resolve-dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'arbiter', 'x-arbiter-token': 'arbiter2026' },
      body: JSON.stringify({ role: 'arbiter', resolution: 'CUSTOM_SPLIT', buyerPct: 40, arbiterSigned: true, arbiterJustification: 'Ngắn' })
    });
    assert.equal(badResolve.status, 400);

    const resolveOk = await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(revId)}/resolve-dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'arbiter', 'x-arbiter-token': 'arbiter2026' },
      body: JSON.stringify({
        role: 'arbiter',
        resolution: 'CUSTOM_SPLIT',
        buyerPct: 40,
        arbiterSigned: true,
        arbiterJustification: 'Freelancer đã hoàn thành phần lõi backend nên chia 40/60.'
      })
    }).then((r) => r.json());
    assert.equal(resolveOk.ok, true);
    assert.equal(resolveOk.contract.status, 'AWAITING_CONFIRMATION');
    assert.deepEqual(resolveOk.contract.resolutionAccepted, { buyer: false, seller: false });

    const appeal1 = await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(revId)}/appeal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({ role: 'client', reason: 'Yêu cầu xem xét lại tỷ lệ' })
    }).then((r) => r.json());
    assert.equal(appeal1.ok, true);
    assert.equal(appeal1.contract.status, 'APPEALED');
    assert.equal(appeal1.contract.appealCounts.buyer, 1);

    const appeal2 = await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(revId)}/appeal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({ role: 'client', reason: 'Khiếu nại lần 2' })
    });
    assert.equal(appeal2.status, 400);

    const reReview = await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(revId)}/resolve-dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'arbiter', 'x-arbiter-token': 'arbiter2026' },
      body: JSON.stringify({
        role: 'arbiter',
        resolution: 'CUSTOM_SPLIT',
        buyerPct: 40,
        keepOriginal: true,
        arbiterSigned: true,
        arbiterJustification: 'Giữ nguyên tỷ lệ 40/60 sau khi tái thẩm.'
      })
    }).then((r) => r.json());
    assert.equal(reReview.ok, true);
    assert.equal(reReview.contract.status, 'AWAITING_CONFIRMATION');

    const agreeClient = await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(revId)}/agree-resolution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({ role: 'client' })
    }).then((r) => r.json());
    assert.equal(agreeClient.contract.resolutionAccepted.buyer, true);
    assert.equal(agreeClient.autoFinalized, false);

    const agreeSeller = await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(revId)}/agree-resolution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'freelancer' },
      body: JSON.stringify({ role: 'freelancer' })
    }).then((r) => r.json());
    assert.equal(agreeSeller.autoFinalized, true);
    assert.equal(agreeSeller.contract.status, 'COMPLETED');

    // Xác nhận data/db.json gốc không bị thay đổi
    const dbAfter = fs.existsSync(dbPath) ? fs.readFileSync(dbPath, 'utf8') : null;
    assert.equal(dbAfter, dbBefore);
  } finally {
    server.close();
    if (prevOffline === undefined) delete process.env.OFFLINE_MODE;
    else process.env.OFFLINE_MODE = prevOffline;
  }
});
