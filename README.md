# 🛡️ VibeEscrow — Agentic AI Escrow & Avalanche Fuji Settlement

Hệ thống ký quỹ giao dịch thông minh (**Escrow 2-of-3 Multi-Sig**) tích hợp **4 tầng Agentic AI** kiểm chứng mã nguồn GitHub trong Sandbox, **VietQR Banking**, và neo bằng chứng nghiệm thu on-chain trên **Avalanche Fuji Testnet**.

---

## ✨ Tính năng nổi bật

- **Phân quyền 3 vai trò độc lập (Client / Freelancer / Arbiter)**:
  - **Client (Buyer)**: Tạo hợp đồng, chia Milestone (40% / 60%), nạp quỹ qua VietQR, kiểm tra bàn giao (HITL Checklist), yêu cầu chỉnh sửa (`REVISION_REQUESTED`), mở tranh chấp (`DISPUTED`) hoặc ký duyệt giải ngân.
  - **Freelancer (Seller)**: Nộp link GitHub Commit & Preview URL, theo dõi kết quả kiểm thử tự động, phản hồi yêu cầu chỉnh sửa.
  - **Arbiter (Trọng tài)**: Xác thực qua `ARBITER_AUTH_TOKEN`, xét duyệt nạp tiền VietQR và phân xử tranh chấp (`RELEASE_FREELANCER`, `REFUND_CLIENT`, `SPLIT_50_50`, hoặc chia tỷ lệ linh hoạt theo bằng chứng).
- **Multi-Sig 2-of-3 & Timelock**:
  - Bắt buộc tối thiểu 2/3 chữ ký hợp lệ (`multiSigGuard.mjs`) trước khi giải ngân hoặc phân xử.
  - Hỗ trợ giải ngân từng phần theo Milestone và Worker tự động giải ngân khi quá hạn Timelock đối với hợp đồng đã đạt chuẩn.
- **Hệ thống 4 Tầng Agentic AI & Guardrails**:
  1. **Criteria Refiner & Anti-Hallucination** (`criteriaRefiner.mjs`, `schemaGuard.mjs`, `baselineManager.mjs`): Chuẩn hóa tiêu chí mơ hồ, đóng băng baseline bằng SHA-256.
  2. **Autonomous Sandbox Verifier** (`githubVerifier.mjs`, `resilienceGuard.mjs`): Clone & chạy test repo GitHub trong môi trường cô lập `env` (lọc bỏ toàn bộ `PRIVATE_KEY`, `SECRET`, `API_KEY`), tự động fallback sang Rule Engine khi LLM timeout/lỗi.
  3. **Technical Assessor** (`ruleEngine.mjs`, `agents.js`): Đánh giá tiêu chí `PASSED`/`FAILED`, xuất `testReportHash`, đảm bảo không mâu thuẫn khuyến nghị.
  4. **Fact-finding Bailiff & Settlement Calculator** (`settlementCalculator.mjs`): Tính toán tỷ lệ chia quỹ minh bạch khi xảy ra tranh chấp.
- **Avalanche Fuji On-Chain Proof** (`contracts/EscrowCore.sol`, `src/blockchain/fujiBridge.mjs`):
  - Ghi nhận `WorkAgreement`, `MilestoneEscrow` và `ProofRegistry` (`recordVerification()`) trên Avalanche Fuji Testnet (Chain ID `43113`).

---

## 🗂️ Cấu trúc thư mục

```text
naruto_hackday15/
├── contracts/
│   └── EscrowCore.sol            # Smart Contract Solidity 0.8.20 (Escrow + ProofRegistry)
├── scripts/
│   └── deployFuji.cjs            # Script deploy lên Avalanche Fuji Testnet
├── src/
│   ├── index.html                # Giao diện chính (Client / Freelancer / Arbiter)
│   ├── app.js                    # Logic trạng thái Escrow, Multi-Sig & điều phối UI
│   ├── agents.js                 # 4 tầng Agentic AI & kết nối Gemini / Avalanche API
│   ├── bank-ui.js                # Giao diện nạp tiền VietQR & sổ cái giao dịch
│   ├── server.mjs                # HTTP Server & REST API
│   ├── blockchain/
│   │   └── fujiBridge.mjs        # Cầu nối gọi ProofRegistry trên Avalanche Fuji
│   ├── engine/
│   │   ├── baselineManager.mjs   # Quản lý & băm SHA-256 baseline tiêu chí
│   │   ├── criteriaRefiner.mjs   # Chuẩn hóa tiêu chí nghiệm thu
│   │   ├── multiSigGuard.mjs     # Kiểm tra chữ ký Multi-Sig 2-of-3
│   │   ├── resilienceGuard.mjs   # LLM fallback & cô lập biến môi trường Sandbox
│   │   ├── ruleEngine.mjs        # Đánh giá kết quả kiểm thử thuần túy
│   │   ├── schemaGuard.mjs       # Chống ảo giác (Anti-Hallucination) cho AI Agent
│   │   └── settlementCalculator.mjs # Tính toán chia quỹ tranh chấp
│   ├── middleware/
│   │   └── apiSecurity.mjs       # Rate Limiter, Anti-SSRF, Security Headers
│   └── tools/
│       ├── agentTools.mjs        # Công cụ cho Agent (fetch diff, sandbox, rule, anchor)
│       └── githubVerifier.mjs    # Kiểm chứng URL GitHub & chạy test trong Sandbox
├── tests/                        # Bộ kiểm thử tự động (node --test)
├── hardhat.config.cjs            # Cấu hình Hardhat cho Avalanche Fuji (43113)
├── package.json
└── .env.example
```

---

## 🚀 Cài đặt & Chạy dự án

### 1. Yêu cầu hệ thống
- **Node.js** `>= 18`
- **Git** (để Sandbox Verifier clone & kiểm tra repo GitHub)

### 2. Cài đặt dependencies & cấu hình môi trường
```bash
npm install
cp .env.example .env
```

Cập nhật các biến môi trường trong `.env` (tùy chọn khi chạy local, bắt buộc khi dùng LLM / deploy Fuji):
- `GEMINI_API_KEY` — API key Google Gemini cho Agentic AI (nếu bỏ trống hệ thống tự chạy `RULE_FALLBACK_ACTIVE`).
- `GITHUB_TOKEN` — Token GitHub (nếu cần tăng rate limit khi fetch repo/commit).
- `AVALANCHE_API_KEY`, `FUJI_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `AGENT_RELAY_PRIVATE_KEY` — Cấu hình Avalanche Fuji Testnet.
- `ARBITER_AUTH_TOKEN` — Token xác thực quyền Trọng tài trên server.

### 3. Khởi chạy Server
```bash
node src/server.mjs
```
*(Hoặc `npm run dev`)*

### 4. Chạy toàn bộ kiểm thử tự động
```bash
node --test tests/*.test.mjs
```
Hiện tại toàn bộ **49/49 test cases** trên 9 file test đều PASS.

### 5. Biên dịch & Deploy Smart Contract (Avalanche Fuji)
```bash
npx hardhat compile
npx hardhat run scripts/deployFuji.cjs --network fuji
```

---

## 🔒 Bảo mật
- `.env`, `.env.*`, `data/db.json`, `*.pem`, `*.key` được loại trừ trong `.gitignore`.
- Tiến trình chạy test repo bên thứ ba luôn đi qua `buildSanitizedChildEnv()` để loại bỏ toàn bộ secret khỏi `process.env`.
- Hỗ trợ Rate Limiting, Anti-SSRF, XSS escaping (`escapeHtml`) và giới hạn kích thước request body.

---

## 📄 Giấy phép
[MIT](LICENSE)
