/**
 * Multi-Sig 2-of-3 Guard (src/engine/multiSigGuard.mjs)
 * Kiểm tra điều kiện chữ ký bắt buộc trước khi giải ngân hoặc phân xử tranh chấp.
 */

export function countValidSignatures(signatures) {
  if (!signatures || typeof signatures !== 'object') return 0;
  const hasBuyer = Boolean(signatures.client || signatures.buyer);
  const hasSeller = Boolean(signatures.freelancer || signatures.seller);
  const hasArbiter = Boolean(signatures.arbiter);
  return [hasBuyer, hasSeller, hasArbiter].filter(Boolean).length;
}

/**
 * Kiểm tra điều kiện Multi-Sig 2-of-3:
 * - Bắt buộc countValidSignatures(contract.signatures) >= 2.
 * - actionType === "RELEASE": bắt buộc có chữ ký của cả Client (buyer) và Freelancer (seller).
 * - actionType === "DISPUTE_RESOLUTION": bắt buộc có chữ ký của Arbiter cùng ít nhất 1 bên (Client hoặc Freelancer).
 */
export function assertMultiSig2Of3(contract, actionType = 'RELEASE') {
  if (!contract || typeof contract !== 'object' || !contract.signatures) {
    return {
      ok: false,
      count: 0,
      missing: ['client', 'freelancer', 'arbiter'],
      error: 'Thiếu thông tin chữ ký Multi-Sig 2-of-3 trên hợp đồng.'
    };
  }

  const sigs = contract.signatures;
  const hasBuyer = Boolean(sigs.client || sigs.buyer);
  const hasSeller = Boolean(sigs.freelancer || sigs.seller);
  const hasArbiter = Boolean(sigs.arbiter);
  const count = countValidSignatures(sigs);

  const missing = [];
  if (!hasBuyer) missing.push('Client (Buyer)');
  if (!hasSeller) missing.push('Freelancer (Seller)');
  if (!hasArbiter) missing.push('Arbiter (Trọng tài)');

  if (count < 2) {
    return {
      ok: false,
      count,
      missing,
      error: `Chưa đủ chữ ký Multi-Sig 2-of-3 (hiện có ${count}/3, đang thiếu: ${missing.join(', ')}).`
    };
  }

  const mode = String(actionType || 'RELEASE').toUpperCase();
  if (mode === 'RELEASE' && (!hasBuyer || !hasSeller)) {
    const missingParties = [];
    if (!hasBuyer) missingParties.push('Client (Buyer)');
    if (!hasSeller) missingParties.push('Freelancer (Seller)');
    return {
      ok: false,
      count,
      missing: missingParties,
      error: `Giải ngân RELEASE bắt buộc đủ chữ ký của cả Client và Freelancer (đang thiếu: ${missingParties.join(', ')}).`
    };
  }

  if (mode === 'DISPUTE_RESOLUTION' && (!hasArbiter || (!hasBuyer && !hasSeller))) {
    const missingDispute = [];
    if (!hasArbiter) missingDispute.push('Arbiter (Trọng tài)');
    if (!hasBuyer && !hasSeller) missingDispute.push('ít nhất 1 bên (Client hoặc Freelancer)');
    return {
      ok: false,
      count,
      missing: missingDispute,
      error: `Phân xử DISPUTE_RESOLUTION bắt buộc có chữ ký của Arbiter và ít nhất 1 bên tham gia (đang thiếu: ${missingDispute.join(', ')}).`
    };
  }

  return { ok: true, count, missing: [] };
}
