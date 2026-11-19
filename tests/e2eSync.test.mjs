import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPreviewServer } from '../src/server.mjs';
import { countValidSignatures } from '../src/engine/multiSigGuard.mjs';

test('E2E Full-Stack Sync: Tạo hợp đồng & nạp quỹ -> Nộp bài -> Yêu cầu sửa -> Nộp lại -> Nghiệm thu COMPLETED', async () => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Ghi nhận số dư Freelancer ban đầu
    const initialFreelancerState = await fetch(`${baseUrl}/api/state?role=freelancer`).then((r) => r.json());
    const initialFreelancerBalance = initialFreelancerState.freelancerBalance;

    // 1. Client tạo hợp đồng & nạp quỹ (1/3 chữ ký Buyer)
    const createRes = await fetch(`${baseUrl}/api/contracts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({
        title: 'Xây dựng Landing Page & API Thanh toán',
        amount: 4000000,
        acceptanceCriteria: 'Đạt 100% unit test & giao diện responsive',
        maxRevisions: 3
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.ok, true);
    const contractId = created.contract.id;
    assert.equal(created.contract.status, 'FUNDED');
    assert.equal(created.contract.signatures.buyer, true);
    assert.equal(created.contract.signatures.seller, false);
    assert.equal(countValidSignatures(created.contract.signatures), 1);

    // 2. Freelancer nộp bài bàn giao -> DELIVERED_TO_CLIENT (2/3 chữ ký)
    const deliver1Res = await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(contractId)}/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'freelancer' },
      body: JSON.stringify({
        repoUrl: 'https://github.com/vercel/next.js',
        commitHash: '1111111',
        previewUrl: 'https://v1-preview.vercel.app',
        deliveryNotes: 'Hoàn thành bản v1',
        verificationReport: { allObjectivePassed: true, passedCount: 4, totalCount: 4 }
      })
    });
    assert.equal(deliver1Res.status, 200);
    const delivered1 = await deliver1Res.json();
    assert.equal(delivered1.ok, true);
    assert.equal(delivered1.contract.status, 'DELIVERED_TO_CLIENT');
    assert.equal(delivered1.contract.signatures.seller, true);
    assert.equal(countValidSignatures(delivered1.contract.signatures), 2);

    // 3. Client gửi yêu cầu chỉnh sửa -> REVISION_REQUESTED, revisionsUsed = 1, signatures.seller = false (1/3)
    const revRes = await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(contractId)}/request-revision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({
        reason: 'Bổ sung kiểm tra lỗi đầu vào và responsive mobile'
      })
    });
    assert.equal(revRes.status, 200);
    const revBody = await revRes.json();
    assert.equal(revBody.ok, true);
    assert.equal(revBody.contract.status, 'REVISION_REQUESTED');
    assert.equal(revBody.contract.revisionsUsed, 1);
    assert.equal(revBody.contract.signatures.seller, false);
    assert.ok(revBody.contract.activeRevision);
    assert.equal(countValidSignatures(revBody.contract.signatures), 1);

    // 4. Freelancer nộp lại bản sửa mới -> DELIVERED_TO_CLIENT (2/3 chữ ký)
    const deliver2Res = await fetch(`${baseUrl}/api/contracts/${encodeURIComponent(contractId)}/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'freelancer' },
      body: JSON.stringify({
        deliverableUrl: 'https://github.com/vercel/next.js/tree/canary',
        commitSha: '2222222',
        previewUrl: 'https://v2-preview.vercel.app',
        deliveryNotes: 'Đã sửa responsive & validation',
        verificationReport: { allObjectivePassed: true, passedCount: 4, totalCount: 4 }
      })
    });
    assert.equal(deliver2Res.status, 200);
    const delivered2 = await deliver2Res.json();
    assert.equal(delivered2.ok, true);
    assert.equal(delivered2.contract.status, 'DELIVERED_TO_CLIENT');
    assert.equal(delivered2.contract.signatures.seller, true);
    assert.equal(countValidSignatures(delivered2.contract.signatures), 2);

    // 5. Client ký duyệt nghiệm thu -> COMPLETED, số dư Freelancer tăng đúng số tiền sau phí
    const releaseRes = await fetch(`${baseUrl}/api/milestones/${encodeURIComponent(contractId)}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'client' },
      body: JSON.stringify({ percent: 100, buyerSigned: true })
    });
    assert.equal(releaseRes.status, 200);
    const released = await releaseRes.json();
    assert.equal(released.ok, true);
    assert.equal(released.contract.status, 'COMPLETED');
    assert.equal(released.contract.amount, 0);

    const afterFreelancerState = await fetch(`${baseUrl}/api/state?role=freelancer`).then((r) => r.json());
    assert.equal(
      afterFreelancerState.freelancerBalance,
      initialFreelancerBalance + released.feeInfo.netPayout
    );
    assert.equal(fs.existsSync('data/db.json'), true);
  } finally {
    server.close();
  }
});
