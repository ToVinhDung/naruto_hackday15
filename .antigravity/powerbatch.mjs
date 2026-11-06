#!/usr/bin/env node
/**
 * Antigravity PowerBatch Engine (.antigravity/powerbatch.mjs)
 * Thực thi các batch tác vụ nguyên tử, kiểm tra Guardrails, xác thực White UI Design Tokens,
 * kiểm tra cấu hình Vercel và xuất báo cáo Self-Healing JSON cho Google Antigravity Engine.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const CONFIG_PATH = path.join(ROOT_DIR, '.antigravity', 'config.json');
const TEST_COMMANDS_PATH = path.join(ROOT_DIR, '.antigravity', 'test_commands.json');
const REPORT_PATH = path.join(ROOT_DIR, '.antigravity', 'powerbatch-report.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function auditGuardrails() {
  const config = readJson(CONFIG_PATH);
  const issues = [];

  if (!config.guardrails?.requireHumanInTheLoopForSecrets) {
    issues.push('HITL cho Secrets chưa được bật trong .antigravity/config.json');
  }
  if (!Array.isArray(config.guardrails?.commandWhitelist) || config.guardrails.commandWhitelist.length === 0) {
    issues.push('Command Whitelist trống');
  }

  for (const anchor of config.contextAnchors || []) {
    const fullPath = path.join(ROOT_DIR, anchor);
    if (!fs.existsSync(fullPath)) {
      issues.push(`Context Anchor bị thiếu: ${anchor}`);
    }
  }

  // Quét đảm bảo không có khóa bí mật thực bị hardcode trong src/
  const srcDir = path.join(ROOT_DIR, 'src');
  if (fs.existsSync(srcDir)) {
    const files = fs.readdirSync(srcDir);
    for (const file of files) {
      const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
      if (/sk_live_[0-9a-zA-Z]{16,}|AIza[0-9A-Za-z-_]{35}/.test(content)) {
        issues.push(`Phát hiện nghi vấn lộ API secret trong src/${file}`);
      }
    }
  }

  if (issues.length > 0) {
    console.error('[PowerBatch][Guardrails] FAILED:\n - ' + issues.join('\n - '));
    process.exit(1);
  }
  console.log('[PowerBatch][Guardrails] PASSED: Whitelist, Context Anchors và Secret Guardrails hợp lệ.');
}

function verifyUiTokens() {
  const cssPath = path.join(ROOT_DIR, 'src', 'styles.css');
  if (!fs.existsSync(cssPath)) {
    console.error('[PowerBatch][WhiteUI] FAILED: Không tìm thấy src/styles.css');
    process.exit(1);
  }
  const css = fs.readFileSync(cssPath, 'utf8');
  const requiredTokens = [
    '--bg-primary: #FFFFFF',
    '--bg-secondary: #F8FAFC',
    '--text-primary: #0F172A',
    '--border-color: #E2E8F0'
  ];

  const missing = requiredTokens.filter((token) => !css.toLowerCase().includes(token.toLowerCase()));
  if (missing.length > 0) {
    console.error('[PowerBatch][WhiteUI] FAILED: Thiếu White UI Design Tokens:', missing.join(', '));
    process.exit(1);
  }
  console.log('[PowerBatch][WhiteUI] PASSED: Giao diện tuân thủ chuẩn White Tone Design System.');
}

function verifyVercel() {
  const vercelPath = path.join(ROOT_DIR, 'vercel.json');
  if (!fs.existsSync(vercelPath)) {
    console.error('[PowerBatch][Vercel] FAILED: Không tìm thấy file cấu hình vercel.json');
    process.exit(1);
  }
  const vercelConfig = readJson(vercelPath);
  if (!vercelConfig.rewrites && !vercelConfig.routes && !vercelConfig.cleanUrls) {
    console.error('[PowerBatch][Vercel] FAILED: vercel.json thiếu cấu hình routing/cleanUrls');
    process.exit(1);
  }
  const indexHtml = path.join(ROOT_DIR, 'src', 'index.html');
  if (!fs.existsSync(indexHtml)) {
    console.error('[PowerBatch][Vercel] FAILED: Thiếu entrypoint src/index.html');
    process.exit(1);
  }
  console.log('[PowerBatch][Vercel] PASSED: Cấu hình Vercel Cloud Preview & Production hợp lệ.');
}

function runFullBatchPipeline() {
  const suite = readJson(TEST_COMMANDS_PATH);
  const startedAt = new Date().toISOString();
  const results = [];
  let allPassed = true;

  console.log(`==============================================================`);
  console.log(`⚡ POWERBATCH ORCHESTRATOR - ${suite.pipelineName}`);
  console.log(`==============================================================`);

  for (const batch of suite.batches) {
    const startMs = Date.now();
    process.stdout.write(`▶ [${batch.id}] ${batch.name} ... `);
    try {
      const stdout = execSync(batch.command, {
        cwd: ROOT_DIR,
        timeout: batch.timeoutMs || 15000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const durationMs = Date.now() - startMs;
      console.log(`PASSED (${durationMs}ms)`);
      results.push({
        id: batch.id,
        name: batch.name,
        stage: batch.stage,
        status: 'PASSED',
        durationMs,
        stdout: stdout.trim(),
        stderr: ''
      });
    } catch (error) {
      const durationMs = Date.now() - startMs;
      allPassed = false;
      console.log(`FAILED (${durationMs}ms)`);
      const stderr = (error.stderr || error.message || '').toString().trim();
      const stdout = (error.stdout || '').toString().trim();
      results.push({
        id: batch.id,
        name: batch.name,
        stage: batch.stage,
        status: 'FAILED',
        durationMs,
        stdout,
        stderr,
        selfHealingPrompt: `Batch ${batch.id} (${batch.name}) thất bại khi chạy "${batch.command}". Hãy phân tích lỗi sau và tự động vá code:\n${stderr || stdout}`
      });
      if (suite.executionPolicy?.failFast) {
        break;
      }
    }
  }

  const report = {
    pipelineName: suite.pipelineName,
    startedAt,
    completedAt: new Date().toISOString(),
    overallStatus: allPassed ? 'PASSED' : 'FAILED',
    vercelPreviewReady: allPassed,
    totalBatches: suite.batches.length,
    executedBatches: results.length,
    results
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`--------------------------------------------------------------`);
  console.log(`📊 Báo cáo đã lưu tại: .antigravity/powerbatch-report.json`);
  console.log(`🚀 Trạng thái tổng thể: ${report.overallStatus} | Vercel Ready: ${report.vercelPreviewReady}`);
  console.log(`==============================================================`);

  if (!allPassed) {
    process.exit(1);
  }
}

function startLocalServer() {
  console.log('==============================================================');
  console.log('🚀 POWERBATCH - KHOI DONG HE THONG SMART ESCROW AI PLATFORM');
  console.log('==============================================================');
  console.log('▶ Kiem tra Guardrails, White UI Tokens va Vercel Config...');
  auditGuardrails();
  verifyUiTokens();
  verifyVercel();
  console.log('▶ Dang mo trinh duyet tai http://localhost:3000 ...');

  try {
    if (process.platform === 'win32') {
      execSync('start http://localhost:3000');
    }
  } catch (e) {
    // Bo qua neu trinh duyet khong the tu mo
  }

  console.log('▶ Khoi dong Server tai http://localhost:3000 va http://127.0.0.1:3000');
  console.log('   (Nhan Ctrl+C de dung he thong bat cu luc nao)');
  console.log('--------------------------------------------------------------');

  const serverPath = path.join(ROOT_DIR, 'src', 'server.mjs');
  const child = spawn(process.execPath, [serverPath], {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

const action = process.argv[2] || 'verify';
switch (action) {
  case 'start':
  case 'dev':
    startLocalServer();
    break;
  case 'audit-guardrails':
    auditGuardrails();
    break;
  case 'verify-ui-tokens':
    verifyUiTokens();
    break;
  case 'verify-vercel':
    verifyVercel();
    break;
  case 'verify':
  default:
    runFullBatchPipeline();
    break;
}

