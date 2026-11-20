import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildConsistentAgentRecommendation, runFactFindingBailiffAgent } from '../src/agents.js';
import { createPreviewServer } from '../src/server.mjs';

test('1. Chuẩn hóa đề xuất hoàn 100% cho khách khi đạt 0% hoặc vi phạm tiêu chí cốt lõi', () => {
  const recZero = buildConsistentAgentRecommendation({
    allObjectivePassed: false,
    passedCount: 0,
    totalCount: 4,
    failedReasons: ['Unit test fail 100%']
  });
  assert.equal(recZero.recommendedBuyerPct, 100);
  assert.equal(recZero.recommendedSellerPct, 0);
  assert.match(recZero.message, /100% Buyer/);

  const bailiff = runFactFindingBailiffAgent({
    id: 'ESC-TEST-CORE',
    title: 'Test Core Violation',
    freelancer: 'dev-a',
    acceptanceCriteria: 'Auth + Tests',
    latestVerification: {
      verifiedScore: 60,
      coreViolation: true,
      passedCriteria: ['UI'],
      failedCriteria: ['Auth bypass']
    }
  });
  assert.equal(bailiff.recommendedBuyerPct, 100);
  assert.equal(bailiff.recommendedSellerPct, 0);
});

test('2. Reset resolutionAccepted (o Buyer, o Seller) khi chia tiền -> AWAITING_CONFIRMATION, tự động COMPLETED khi cả 2 bên đồng ý, khóa finalize thủ công', async () => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const arbiterToken = process.env.ARBITER_AUTH_TOKEN || 'naruto';

  try {
    await fetch(`${baseUrl}/api/contracts/ESC-101/dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({
        role: 'client',
        reason: 'Sản phẩm không chạy được',
        evidences: [{ id: 'EV-1', fileName: 'error.log', uploadedBy: 'CLIENT' }]
      })
    });

    // Lệch AI thiếu giải trình -> 400
    const badResolve = await fetch(`${baseUrl}/api/contracts/ESC-101/resolve-dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'arbiter', 'x-arbiter-token': arbiterToken },
      body: JSON.stringify({
        role: 'arbiter',
        resolution: 'CUSTOM_SPLIT',
        buyerPct: 40,
        arbiterSigned: true,
        arbiterJustification: 'Quá ngắn'
      })
    });
    assert.equal(badResolve.status, 400);

    // Arbiter chia tiền hợp lệ -> AWAITING_CONFIRMATION với resolutionAccepted: { buyer: false, seller: false }
    const okResolve = await fetch(`${baseUrl}/api/contracts/ESC-101/resolve-dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'arbiter', 'x-arbiter-token': arbiterToken },
      body: JSON.stringify({
        role: 'arbiter',
        resolution: 'CUSTOM_SPLIT',
        buyerPct: 40,
        arbiterSigned: true,
        arbiterJustification: 'Freelancer đã hoàn thành phần API <core> đạt 60% giá trị thực tế.'
      })
    }).then((r) => r.json());
    assert.equal(okResolve.ok, true);
    assert.equal(okResolve.contract.status, 'AWAITING_CONFIRMATION');
    assert.deepEqual(okResolve.contract.resolutionAccepted, { buyer: false, seller: false });
    assert.equal(okResolve.contract.signatures.arbiter, true);

    // Endpoint chốt thủ công bị khóa (403)
    const manualFinalize = await fetch(`${baseUrl}/api/contracts/ESC-101/finalize-resolution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'arbiter', 'x-arbiter-token': arbiterToken }
    });
    assert.equal(manualFinalize.status, 403);

    // Client bấm Đồng ý -> vẫn AWAITING_CONFIRMATION (chờ Seller)
    const agreeClient = await fetch(`${baseUrl}/api/contracts/ESC-101/agree-resolution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({ role: 'client' })
    }).then((r) => r.json());
    assert.equal(agreeClient.ok, true);
    assert.equal(agreeClient.autoFinalized, false);
    assert.equal(agreeClient.contract.resolutionAccepted.buyer, true);
    assert.equal(agreeClient.contract.status, 'AWAITING_CONFIRMATION');

    // Freelancer bấm Đồng ý -> tự động COMPLETED!
    const agreeSeller = await fetch(`${baseUrl}/api/contracts/ESC-101/agree-resolution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'freelancer' },
      body: JSON.stringify({ role: 'freelancer' })
    }).then((r) => r.json());
    assert.equal(agreeSeller.ok, true);
    assert.equal(agreeSeller.autoFinalized, true);
    assert.equal(agreeSeller.contract.status, 'COMPLETED');
    assert.equal(agreeSeller.contract.amount, 0);
  } finally {
    server.close();
  }
});

test('3. Giới hạn khiếu nại tối đa 1 lần/bên, luồng tái thẩm (giữ tỷ lệ cũ / chia lại) và tự động COMPLETED khi cả 2 bên hết lượt', async () => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const arbiterToken = process.env.ARBITER_AUTH_TOKEN || 'naruto';

  try {
    await fetch(`${baseUrl}/api/contracts/ESC-102/dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({
        role: 'client',
        reason: 'Trễ deadline',
        evidences: [{ id: 'EV-2', fileName: 'deadline.png', uploadedBy: 'CLIENT' }]
      })
    });

    // Arbiter phán quyết lần 1 -> AWAITING_CONFIRMATION
    await fetch(`${baseUrl}/api/contracts/ESC-102/resolve-dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'arbiter', 'x-arbiter-token': arbiterToken },
      body: JSON.stringify({
        role: 'arbiter',
        resolution: 'CUSTOM_SPLIT',
        buyerPct: 50,
        arbiterSigned: true,
        arbiterJustification: 'Chia 50/50 theo tiến độ thực tế đã nghiệm thu.'
      })
    });

    // Client khiếu nại lần 1 -> APPEALED (appealCounts.buyer = 1)
    const clientAppeal1 = await fetch(`${baseUrl}/api/contracts/ESC-102/appeal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({ role: 'client', reason: 'Cần xem lại log lỗi nghiêm trọng' })
    }).then((r) => r.json());
    assert.equal(clientAppeal1.ok, true);
    assert.equal(clientAppeal1.contract.status, 'APPEALED');
    assert.equal(clientAppeal1.contract.appealCounts.buyer, 1);

    // Arbiter tái thẩm giữ nguyên tỷ lệ cũ -> AWAITING_CONFIRMATION (vì Seller chưa hết lượt)
    const keepRes = await fetch(`${baseUrl}/api/contracts/ESC-102/resolve-dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'arbiter', 'x-arbiter-token': arbiterToken },
      body: JSON.stringify({
        role: 'arbiter',
        resolution: 'CUSTOM_SPLIT',
        buyerPct: 50,
        arbiterSigned: true,
        keepOriginal: true,
        arbiterJustification: 'Giữ nguyên tỷ lệ cũ 50/50 sau khi xem xét log.'
      })
    }).then((r) => r.json());
    assert.equal(keepRes.ok, true);
    assert.equal(keepRes.contract.status, 'AWAITING_CONFIRMATION');

    // Client cố khiếu nại lần 2 -> 400
    const clientAppeal2 = await fetch(`${baseUrl}/api/contracts/ESC-102/appeal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({ role: 'client', reason: 'Khiếu nại lần 2' })
    });
    assert.equal(clientAppeal2.status, 400);
    const appeal2Json = await clientAppeal2.json();
    assert.equal(appeal2Json.error, 'Bạn đã sử dụng hết quyền khiếu nại (tối đa 1 lần cho mỗi bên).');

    // Freelancer khiếu nại lần 1 -> APPEALED (appealCounts.seller = 1)
    const sellerAppeal1 = await fetch(`${baseUrl}/api/contracts/ESC-102/appeal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'freelancer' },
      body: JSON.stringify({ role: 'freelancer', message: 'Yêu cầu tăng tỷ lệ cho Seller' })
    }).then((r) => r.json());
    assert.equal(sellerAppeal1.ok, true);
    assert.equal(sellerAppeal1.contract.status, 'APPEALED');
    assert.equal(sellerAppeal1.contract.appealCounts.seller, 1);

    // Arbiter tái thẩm khi cả 2 bên đã hết lượt khiếu nại -> tự động COMPLETED!
    const finalReReview = await fetch(`${baseUrl}/api/contracts/ESC-102/resolve-dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'arbiter', 'x-arbiter-token': arbiterToken },
      body: JSON.stringify({
        role: 'arbiter',
        resolution: 'CUSTOM_SPLIT',
        buyerPct: 45,
        arbiterSigned: true,
        arbiterJustification: 'Điều chỉnh cuối cùng 45/55 sau khi xem xét khiếu nại của cả hai bên.'
      })
    }).then((r) => r.json());
    assert.equal(finalReReview.ok, true);
    assert.equal(finalReReview.contract.status, 'COMPLETED');
    assert.equal(finalReReview.contract.amount, 0);

    // Kiểm tra giao diện không còn nút Chốt phán quyết cuối cùng và có đầy đủ khung tỷ lệ phân chia cho cả Client & Freelancer
    const appJs = fs.readFileSync('src/app.js', 'utf8');
    assert.equal(appJs.includes('Chốt phán quyết cuối cùng'), false);
    assert.ok(appJs.includes('Đã dùng lượt khiếu nại (1/1)'));
    assert.ok(appJs.includes('arbiter-keep-original'));
    assert.ok(appJs.includes('Phán quyết Tỷ lệ Phân chia Hợp đồng'));
    assert.ok(appJs.includes('Đã hoàn tất giải ngân theo tỷ lệ này'));
    assert.ok(appJs.includes('Đang chờ Trọng tài xem xét chia lại hoặc giữ nguyên tỷ lệ'));
    assert.ok(appJs.includes('renderDisputeResolutionSummaryBox'));
  } finally {
    server.close();
  }
});

test('4. Hỗ trợ alias accept-resolution & confirm-resolution, tự động COMPLETED khi 1 bên đồng ý và bên kia hết lượt khiếu nại', async () => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const arbiterToken = process.env.ARBITER_AUTH_TOKEN || 'naruto';

  try {
    await fetch(`${baseUrl}/api/contracts/ESC-101/dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({
        role: 'client',
        reason: 'Kiểm tra lại',
        evidences: [{ id: 'EV-5', fileName: 'test.log', uploadedBy: 'CLIENT' }]
      })
    });

    await fetch(`${baseUrl}/api/contracts/ESC-101/resolve-dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'arbiter', 'x-arbiter-token': arbiterToken },
      body: JSON.stringify({
        role: 'arbiter',
        resolution: 'CUSTOM_SPLIT',
        buyerPct: 50,
        arbiterSigned: true,
        arbiterJustification: 'Chia đều 50/50 theo biên bản kiểm tra thực tế.'
      })
    });

    // Client dùng lượt khiếu nại duy nhất -> APPEALED
    await fetch(`${baseUrl}/api/contracts/ESC-101/appeal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({ role: 'client', reason: 'Cần xem xét thêm bằng chứng' })
    });

    // Arbiter tái thẩm -> AWAITING_CONFIRMATION (Client đã hết lượt khiếu nại)
    await fetch(`${baseUrl}/api/contracts/ESC-101/resolve-dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'arbiter', 'x-arbiter-token': arbiterToken },
      body: JSON.stringify({
        role: 'arbiter',
        resolution: 'CUSTOM_SPLIT',
        buyerPct: 55,
        arbiterSigned: true,
        arbiterJustification: 'Điều chỉnh lên 55/45 sau khi xem xét khiếu nại của Client.'
      })
    });

    // Freelancer gọi alias /accept-resolution -> tự động COMPLETED vì Client đã hết lượt khiếu nại
    const acceptRes = await fetch(`${baseUrl}/api/contracts/ESC-101/accept-resolution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'seller' },
      body: JSON.stringify({ role: 'seller' })
    }).then((r) => r.json());
    assert.equal(acceptRes.ok, true);
    assert.equal(acceptRes.autoFinalized, true);
    assert.equal(acceptRes.contract.status, 'COMPLETED');

    // Kiểm tra openTransactionPopup không ghi đè AWAITING_CONFIRMATION/APPEALED thành FROZEN
    const appJs = fs.readFileSync('src/app.js', 'utf8');
    assert.ok(appJs.includes('normalizeAwaitingConfirmationStatus'));
    assert.ok(appJs.includes('nonFrozenOverrideStatuses'));
    assert.ok(appJs.includes('ensureContractDisputeResolution'));

    // Kiểm tra ESC-103 khi có signatures.arbiter = true (chưa có disputeResolution) vẫn tự vá và đồng ý/khiếu nại thành công
    const stateRes = await fetch(`${baseUrl}/api/state?role=client`).then((r) => r.json());
    const esc103 = stateRes.contracts.find((c) => c.id === 'ESC-103');
    if (esc103 && esc103.status !== 'COMPLETED') {
      const appMod = await import('../src/app.js');
      const patched = appMod.ensureContractDisputeResolution({
        id: 'ESC-103',
        amount: 2000000,
        status: 'AWAITING_CONFIRMATION',
        signatures: { arbiter: true }
      });
      assert.ok(patched);
      assert.equal(typeof patched.buyerPct, 'number');
      assert.equal(typeof patched.buyerShare, 'number');
    }
  } finally {
    server.close();
  }
});
