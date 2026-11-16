# Project Rules: Agentic AI Escrow System

## 1. Tech Stack & Conventions
- Runtime: Node.js (ES Modules `.mjs`), Express/Fastify (theo cấu trúc hiện tại của `src/server.mjs`).
- Frontend: Next.js / HTML+JS (tương thích với API hiện có).
- Blockchain: Solidity (Avalanche Fuji Testnet), dùng `ethers` v6 hoặc `viem` và thư viện `crypto` (SHA-256) của Node để hash bằng chứng.
- Tuyệt đối không dùng thư viện ngoài không cần thiết nếu Node built-in (`node:crypto`, `node:test`, `node:fs`) đã đáp ứng được.

## 2. Core Architecture Guardrails
- **Tách biệt LLM và Rule Engine**: Mọi quyết định chấm điểm pass/fail, kiểm tra phạm vi file cấm (`forbidden_paths`) và đề xuất giải ngân PHẢI chạy qua Deterministic Rule Engine (`src/engine/ruleEngine.mjs`).
- **HITL (Human-in-the-Loop)**: AI Agent chỉ có quyền ghi `testReportHash` và đề xuất trạng thái (`READY_FOR_CLIENT_REVIEW` hoặc `REQUEST_REVISION`). Tuyệt đối không tạo hàm cho Agent tự động chuyển tiền Escrow.
- **Immutability**: Mọi `baseline.json` sau khi khóa (`frozen: true`) phải được băm SHA-256 và không được phép ghi đè.

## 3. Verification Loop
- Sau khi tạo hoặc sửa bất kỳ file `.mjs` nào, bắt buộc chạy `node --test` hoặc kiểm tra syntax

