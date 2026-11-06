# Lộ trình Phát triển & Danh sách Task (Vibe Coding Roadmap)

## Giai đoạn 1: Khởi tạo Dự án & Giới hạn Vùng an toàn (Foundation & Guardrails)
- [x] **TASK-101**: Thiết lập cấu trúc thư mục chuẩn hóa (`.antigravity/`, `docs/`, `src/`, `tests/`).
- [x] **TASK-102**: Định nghĩa `.antigravity/config.json` với Whitelist lệnh, Secret Guardrails (`.env*`) và Context Anchors.
- [x] **TASK-103**: Xây dựng `.antigravity/system_prompt.md` áp đặt quy chuẩn **White UI Design System** (`#FFFFFF`, `#F8FAFC`, `#0F172A`).

## Giai đoạn 2: Tích hợp PowerBatch Engine & Vercel Pipeline
- [x] **TASK-201**: Xây dựng bộ điều phối **PowerBatch** (`.antigravity/powerbatch.mjs` & `powerbatch.cmd`) hỗ trợ chạy chuỗi kiểm thử nguyên tử trên Windows/Linux.
- [x] **TASK-202**: Cấu hình `.antigravity/test_commands.json` gồm 4 batch: Guardrails Audit, White UI Token Check, Automated Tests, và Vercel Readiness.
- [x] **TASK-203**: Tích hợp cấu hình triển khai đám mây `vercel.json` (Clean URLs, Security Headers, Preview Rewrites).

## Giai đoạn 3: Xây dựng Giao diện Điều khiển Trung tâm (White Tone UI Control Center)
- [x] **TASK-301**: Thiết kế hệ thống CSS Variables tone màu trắng tối giản (`src/styles.css`) theo phong cách Vercel Geist Light.
- [x] **TASK-302**: Xây dựng giao diện **Antigravity Architecture & Vibe Coding Studio** (`src/index.html` & `src/app.js`) gồm:
  - Sơ đồ kiến trúc tương tác trực quan (Antigravity + PowerBatch + Vercel).
  - Bộ mô phỏng thực thi **PowerBatch Pipeline & Self-Healing Loop** thời gian thực.
  - Trình tạo tính năng mẫu (Demo User Story: *"Form nạp tiền với validation > 10.000đ và modal xác nhận"* như trong bản thiết kế).
  - Bảng kiểm tra Guardrails & Vercel Deployment Preview.
- [x] **TASK-303**: Xây dựng Local Preview Server (`src/server.mjs`) hỗ trợ kiểm thử nhanh tại cổng `3000`.

## Giai đoạn 4: Tự động Nghiệm thu & Đánh giá (Automated Verification)
- [x] **TASK-401**: Viết bộ kiểm thử tự động `tests/system.test.mjs` kiểm chứng toàn bộ cấu hình, UI tokens, logic nghiệp vụ và Vercel readiness.
- [x] **TASK-402**: Thực thi `powerbatch.cmd verify` đạt trạng thái `PASSED (100%)` và xuất báo cáo `.antigravity/powerbatch-report.json`.

