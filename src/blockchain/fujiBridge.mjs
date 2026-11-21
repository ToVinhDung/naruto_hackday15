import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DEPLOYMENT_PATH = path.resolve(process.cwd(), 'data', 'fuji-deployment.json');
const DEFAULT_FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
export const SNOWTRACE_FUJI_TX_BASE = 'https://testnet.snowtrace.io/tx/';

/**
 * Chuẩn hóa chuỗi hash bất kỳ (sha256:..., hex, hoặc text) thành bytes32 (`0x` + 64 hex chars).
 */
export function toBytes32(value) {
  const raw = String(value || '').replace(/^sha256:/i, '').replace(/^0x/i, '').trim();
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return `0x${raw.toLowerCase()}`;
  }
  const digest = crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
  return `0x${digest}`;
}

/**
 * Chuyển milestoneId dạng string (VD: "ESC-101" hoặc "MS-1") thành uint256 ổn định.
 */
export function toNumericMilestoneId(milestoneId) {
  if (/^\d+$/.test(String(milestoneId || '').trim())) {
    return BigInt(String(milestoneId).trim());
  }
  const hashHex = crypto.createHash('sha256').update(String(milestoneId || '0'), 'utf8').digest('hex').slice(0, 12);
  return BigInt(`0x${hashHex}`);
}

export function buildSnowtraceTxUrl(txHash) {
  return `${SNOWTRACE_FUJI_TX_BASE}${String(txHash || '').trim()}`;
}

/**
 * Đọc `data/fuji-deployment.json` và gọi hàm `recordVerification()` trên Avalanche Fuji Testnet bằng `ethers` v6.
 * Nếu chưa có file deployment hoặc chưa cấu hình `AGENT_RELAY_PRIVATE_KEY` (hoặc chưa cài `ethers`),
 * trả về trạng thái `onChain: false` kèm lý do rõ ràng mà không làm sập luồng nghiệm thu.
 */
export async function anchorProofOnFuji({
  milestoneId,
  deliverableHash,
  testReportHash,
  score,
  deploymentPath = DEFAULT_DEPLOYMENT_PATH,
  rpcUrl = process.env.FUJI_RPC_URL || DEFAULT_FUJI_RPC,
  privateKey = process.env.AGENT_RELAY_PRIVATE_KEY || ''
} = {}) {
  if (typeof process !== 'undefined' && process.env.OFFLINE_MODE === 'true') {
    const proofDigest = toBytes32(testReportHash || deliverableHash || `${milestoneId}-${score}`);
    return {
      onChain: false,
      offlineMode: true,
      chainId: 43113,
      proofSha256: proofDigest,
      reason: 'OFFLINE_MODE=true: Đã ghi nhận Off-chain SHA-256 Proof (không gọi RPC Avalanche Fuji).',
      txHash: null,
      snowtraceUrl: null
    };
  }
  if (!fs.existsSync(deploymentPath)) {
    return {
      onChain: false,
      chainId: 43113,
      reason: 'Chưa có data/fuji-deployment.json (chưa deploy EscrowCore.sol lên Fuji).',
      txHash: null,
      snowtraceUrl: null
    };
  }

  if (!privateKey) {
    return {
      onChain: false,
      chainId: 43113,
      reason: 'Thiếu biến môi trường AGENT_RELAY_PRIVATE_KEY để ký giao dịch trên Fuji.',
      txHash: null,
      snowtraceUrl: null
    };
  }

  let ethersModule;
  try {
    ethersModule = await import('ethers');
  } catch {
    return {
      onChain: false,
      chainId: 43113,
      reason: 'Chưa cài đặt package ethers v6 (npm install ethers).',
      txHash: null,
      snowtraceUrl: null
    };
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const contractAddress = deployment.contractAddress;
  const abi = deployment.abi;
  if (!contractAddress || !Array.isArray(abi)) {
    return {
      onChain: false,
      chainId: 43113,
      reason: 'File data/fuji-deployment.json thiếu contractAddress hoặc abi.',
      txHash: null,
      snowtraceUrl: null
    };
  }

  const provider = new ethersModule.JsonRpcProvider(rpcUrl);
  const wallet = new ethersModule.Wallet(privateKey, provider);
  const contract = new ethersModule.Contract(contractAddress, abi, wallet);

  const numericMilestoneId = toNumericMilestoneId(milestoneId);
  const delivBytes32 = toBytes32(deliverableHash);
  const reportBytes32 = toBytes32(testReportHash);
  const boundedScore = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));

  const tx = await contract.recordVerification(numericMilestoneId, delivBytes32, reportBytes32, boundedScore);
  const receipt = await tx.wait();
  const txHash = receipt?.hash || tx.hash;

  return {
    onChain: true,
    network: 'Avalanche Fuji Testnet',
    chainId: 43113,
    contractAddress,
    txHash,
    blockNumber: receipt?.blockNumber || null,
    snowtraceUrl: buildSnowtraceTxUrl(txHash)
  };
}

