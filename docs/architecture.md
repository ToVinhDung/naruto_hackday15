# Tài liệu Kiến trúc Hệ thống (System Architecture)
> **Phiên bản**: 3.0 (Bổ sung **5 Lớp Guardrails Chuyên sâu**, **PowerBatch Engine**, **Vercel Cloud Pipeline** & **Bố cục 3 Vùng Không Cuộn Trang - Pure White UI**)

---

## 1. Kiến trúc tổng thể tích hợp Guardrails (Architecture Overview)

```text
                       [ Developer / Vibecoder ]
          (Mô tả tính năng, wireframe, user story, White UI tokens)
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       Google Antigravity Engine                          │
│                                                                          │
│  ┌───────────────────────────┐        ┌───────────────────────────────┐  │
│  │    Context & Workspace    │        │         Planner Agent         │  │
│  │  • AST, git diff, docs    │◄───────┤  • Atomic Task Decomposition  │  │
│  │  • White UI Design Tokens │        │  • PowerBatch Queue Builder   │  │
│  └─────────────┬─────────────┘        └───────────────┬───────────────┘  │
│                │                                      │                  │
│                ▼                                      ▼                  │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                        Coder / Tool Agent                          │  │
│  │  • File Edit Engine (patch / rewrite / create)                     │  │
│  │  • Terminal Execution (node, npm.cmd, git, vercel, powerbatch)     │  │
│  └──────────────────────────────┬─────────────────────────────────────┘  │
└─────────────────────────────────┼────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│          🛡️ TẦNG GUARDRAILS & KIỂM SOÁT AN TOÀN 5 LỚP (BẮT BUỘC)        │
│  [G1] Terminal Command Whitelist : Chỉ cho phép node/npm/git/vercel      │
│                                    Chặn rm -rf, format, git push --force │
│  [G2] Secret & Credential HITL   : Cấm đọc/in .env*, Private Key, API Key│
│  [G3] Git Checkpoint Isolation   : Tự động nhánh vibe-feature-* trước sửa│
│  [G4] Escrow Financial Guardrail : Multi-Sig 2-of-3, Min > 10k, SHA-256  │
│  [G5] Sandbox & Self-Heal Quota  : Timeout 15s/batch, tối đa 3 lần retry │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                ⚡ PowerBatch Orchestration Layer                         │
│  • Chia luồng thực thi theo Batch nguyên tử (Guardrails → UI → Test)    │
│  • Vượt rào cản PowerShell ExecutionPolicy trên Windows qua .cmd/.mjs    │
│  • Tự động xuất báo cáo cấu trúc JSON (.antigravity/powerbatch-report)   │
└────────────────┬────────────────────────────────────────┬────────────────┘
                 │                                        │
                 ▼                                        ▼
┌─────────────────────────────────┐      ┌─────────────────────────────────┐
│     Local Execution Sandbox     │      │    Observability & Preview      │
│  • Linter / Typecheck / Tests   │      │  • Hot-reload Local Server      │
│  • White UI Token Validator     │      │  • 3-Zone Zero-Scroll White UI  │
│  • stdout / stderr JSON Report  │      │  • ▲ Vercel Preview Deployment  │
└────────────────┬────────────────┘      └────────────────┬────────────────┘
                 │                                        │
                 └───────────────┬────────────────────────┘
                                 │
          ┌──────────────────────┴──────────────────────┐
          │ (Nếu mã lỗi ≠ 0: Self-Healing Loop ≤ 3 lần) │ (Nếu PASSED == 0)
          ▼                                             ▼
 [ Quay lại Coder Agent ]                 ┌───────────────────────────────┐
                                          │  ▲ Vercel Cloud Production    │
                                          │  • Git Checkpoint (vibe-*)    │
                                          │  • Edge Network & Preview URL │
                                          └───────────────────────────────┘
```

---

## 2. Đặc tả Chi tiết 5 Lớp Guardrails (Biện pháp An toàn & Giới hạn Rủi ro)

| Mã Lớp | Tên Lớp Guardrail | Cơ chế Kiểm soát Kỹ thuật | Hành động khi Vi phạm |
| :--- | :--- | :--- | :--- |
| **G1** | **Terminal Command Whitelist** | Chỉ cho phép thực thi binary trong danh sách trắng (`node`, `npm.cmd`, `pnpm.cmd`, `git status`, `vercel`, `powerbatch.cmd`). Chặn regex nguy hiểm (`rm -rf`, `format`, `del /f /s /q`, `git push --force`). | Chặn thực thi ngay lập tức (`BLOCKED_BY_GUARDRAIL`) và ghi nhật ký cảnh báo. |
| **G2** | **Human-in-the-Loop (HITL) cho Secrets** | Bảo vệ các tệp nhạy cảm (`.env`, `.env.local`, `.env.production`, `.vercel/.env*`) và quét mẫu khóa bí mật (`sk_live_*`, `AIza*`, Private Key). | Cấm Agent tự động đọc/xuất ra terminal; yêu cầu con người phê duyệt thủ công. |
| **G3** | **Git Checkpoint & Branch Isolation** | Bắt buộc tạo nhánh cô lập `vibe-feature-*` và tạo commit checkpoint trước các đợt refactor lớn. Không cho phép ghi đè nhánh `main`. | Tự động rollback về Git Checkpoint gần nhất nếu PowerBatch thất bại. |
| **G4** | **Escrow Financial & Multi-Sig Guardrails** | Kiểm soát nghiệp vụ giao dịch: Số tiền nạp/rút bắt buộc `> 10.000đ` và `≤ 500.000.000đ`; yêu cầu tối thiểu `2-of-3` chữ ký (Buyer, Seller, Arbiter); đóng băng quỹ (`Freeze Vault`) ngay khi phát sinh tranh chấp. | Từ chối giao dịch hoặc khóa cứng Smart Vault cho tới khi đủ chữ ký / có phán quyết. |
| **G5** | **Sandbox Quota & Self-Healing Limit** | Giới hạn thời gian chạy mỗi batch (`10.000ms–15.000ms`) và giới hạn vòng lặp tự vá lỗi tối đa `3 lần` liên tiếp. | Ngắt vòng lặp tự động và chuyển quyền xử lý về cho Developer (HITL). |

---

## 3. Thiết kế Giao diện 3 Vùng Không Cuộn Trang (3-Zone Zero-Scroll White UI)

- **Bố cục Khung nhìn 100vh (Zero Vertical Scroll)**: Toàn bộ thanh Topbar, dải KPI tài chính và vùng làm việc chính được tối ưu chiều cao để vừa khít trong 1 màn hình máy tính mà không cần kéo thanh cuộn.
- **Cấu trúc 3 Vùng (3 Zones) trong mỗi Cửa sổ (Client • Freelancer • Arbiter)**:
  - **Cửa sổ Client**: `Vùng 1: Nạp Quỹ & Phí` • `Vùng 2: Khởi tạo Hợp đồng & Milestone` • `Vùng 3: Nghiệm thu & Quản lý Vault`
  - **Cửa sổ Freelancer**: `Vùng 1: Nộp Bàn giao SHA-256/IPFS` • `Vùng 2: Rút Thù lao Đa Kênh` • `Vùng 3: Hợp đồng & Ký Multi-Sig`
  - **Cửa sổ Arbiter**: `Vùng 1: Phán quyết & Chia Tỷ lệ (%)` • `Vùng 2: Cổng Chứng cứ (Evidence)` • `Vùng 3: Sổ cái Audit & Tín nhiệm`
  - Khi xem **Tất cả 3 Cửa sổ**: 3 cửa sổ hiển thị thành 3 cột song song, mỗi cửa sổ có thanh chuyển nhanh giữa 3 vùng.
  - Khi chọn **1 Cửa sổ cụ thể**: Cửa sổ đó mở rộng toàn màn hình và **hiển thị đồng thời cả 3 vùng thành 3 cột ngang hàng** để thao tác trực tiếp không cần cuộn!
