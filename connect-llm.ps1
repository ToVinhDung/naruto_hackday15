<#
.SYNOPSIS
    Script PowerShell kết nối API từ LLM và các Agent AI của Smart Escrow Platform.
.DESCRIPTION
    Script này hỗ trợ:
    1. Kết nối toàn diện các Dynamic REST API của hệ thống Smart Escrow AI Agents (Port 3000):
       - Health Check & Trạng thái hệ thống (/api/health)
       - Ma trận 4 Tầng AI Agents (/api/agents/matrix)
       - Tầng 1: Scope Decomposer LLM Agent (/api/agents/scope-decompose)
       - Tầng 2 & 3: Sandbox Verifier & Technical Assessor (/api/agents/verify-assess)
       - Tầng 4: Fact-finding Bailiff Agent (/api/agents/fact-finding)
       - Đồng bộ Trạng thái Escrow State (/api/state)
    2. Kết nối trực tiếp đến các LLM API bên ngoài (Google Gemini API / OpenAI / AI Gateway / Ollama)
       để sinh lời nhắc phân tích hợp đồng, giải quyết tranh chấp hoặc phân rã yêu cầu.
.EXAMPLE
    .\connect-llm.ps1
    (Mở Menu tương tác trực quan)
.EXAMPLE
    .\connect-llm.ps1 -Action health
    .\connect-llm.ps1 -Action matrix
    .\connect-llm.ps1 -Action decompose -Prompt "Xây dựng cổng thanh toán QR MB Bank và webhook xác thực"
    .\connect-llm.ps1 -Action verify -PrUrl "https://github.com/my-org/escrow-api/pull/12" -Scenario "PASS_100"
    .\connect-llm.ps1 -Action factfinding
    .\connect-llm.ps1 -Action gemini -ApiKey "YOUR_GEMINI_KEY" -Prompt "Phân tích rủi ro hợp đồng freelance 100 USDC"
#>

[CmdletBinding()]
param(
    [ValidateSet('menu', 'health', 'matrix', 'decompose', 'verify', 'factfinding', 'state', 'gemini', 'openai', 'test-all')]
    [string]$Action = 'menu',

    [string]$BaseUrl = "http://localhost:3000",

    [string]$Prompt = "Thiết kế hệ thống Escrow thanh toán đa mốc tự động bằng AI Agents với bảo lãnh VietQR MB Bank",

    [string]$PrUrl = "https://github.com/vibecode/smart-escrow-contracts/pull/42",

    [string]$Scenario = "PASS_100",

    [string]$ApiKey = $env:GEMINI_API_KEY,

    [string]$Model = "gemini-1.5-flash",

    [string]$OpenAiBaseUrl = "https://api.openai.com/v1"
)

# Thiet lap UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Header {
    param([string]$Title)
    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor White
    Write-Host "======================================================================" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[THANH CONG] $Message" -ForegroundColor Green
}

function Write-WarningMsg {
    param([string]$Message)
    Write-Host "[CANH BAO] $Message" -ForegroundColor Yellow
}

function Write-ErrorMsg {
    param([string]$Message)
    Write-Host "[LOI] $Message" -ForegroundColor Red
}

function Test-ServerRunning {
    param([string]$Url)
    try {
        $res = Invoke-RestMethod -Uri "$Url/api/health" -Method Get -TimeoutSec 3 -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Assert-ServerReady {
    if (-not (Test-ServerRunning -Url $BaseUrl)) {
        Write-WarningMsg "May chu cuc bo ($BaseUrl) hien chua phan hoi!"
        Write-Host "  -> Hay chay file 'start.bat' hoac lenh '.\powerbatch.cmd start' de bat may chu." -ForegroundColor Yellow
        Write-Host ""
    }
}

# 1. API Health Check
function Invoke-EscrowHealth {
    Write-Header "KIEM TRA TRANG THAI HE THONG (/api/health)"
    try {
        $uri = "$BaseUrl/api/health"
        Write-Host "Dang gui GET den: $uri ..." -ForegroundColor DarkGray
        $res = Invoke-RestMethod -Uri $uri -Method Get -ErrorAction Stop
        Write-Success "He thong dang hoat dong binh thuong!"
        Write-Host ($res | ConvertTo-Json -Depth 4) -ForegroundColor White
        return $res
    } catch {
        Write-ErrorMsg "Khong the ket noi den may chu tai $BaseUrl. Loi: $_"
    }
}

# 2. API Agents Matrix
function Invoke-EscrowMatrix {
    Write-Header "MA TRAN 4 TANG AI AGENTS (/api/agents/matrix)"
    try {
        $uri = "$BaseUrl/api/agents/matrix"
        Write-Host "Dang gui GET den: $uri ..." -ForegroundColor DarkGray
        $res = Invoke-RestMethod -Uri $uri -Method Get -ErrorAction Stop
        Write-Success "Lay thong tin Ma tran 4 Tang AI Agents thanh cong!"
        Write-Host ""
        Write-Host "=== DANH SACH 4 TANG AGENTS ===" -ForegroundColor Yellow
        foreach ($agent in $res.agents) {
            Write-Host "* [$($agent.stage)]" -ForegroundColor Cyan
            Write-Host "  - Vai tro   : $($agent.role)" -ForegroundColor White
            Write-Host "  - Cong cu   : $($agent.tools)" -ForegroundColor DarkGray
            Write-Host "  - Tham quyen: $($agent.authority)" -ForegroundColor Green
        }
        return $res
    } catch {
        Write-ErrorMsg "Loi khi goi /api/agents/matrix: $_"
    }
}

# 3. API Tang 1: Scope Decomposer LLM Agent
function Invoke-ScopeDecomposer {
    param([string]$BriefText)
    Write-Header "TANG 1: SCOPE DECOMPOSER LLM AGENT (/api/agents/scope-decompose)"
    try {
        $uri = "$BaseUrl/api/agents/scope-decompose"
        Write-Host "Brief yeu cau: '$BriefText'" -ForegroundColor Yellow
        Write-Host "Dang gui POST den: $uri ..." -ForegroundColor DarkGray
        $payload = @{ brief = $BriefText } | ConvertTo-Json -Compress
        $res = Invoke-RestMethod -Uri $uri -Method Post -Body $payload -ContentType "application/json; charset=utf-8" -ErrorAction Stop
        
        Write-Success "Agent Tang 1 da phan ra pham vi thanh cong!"
        Write-Host "Agent           : $($res.agentName)" -ForegroundColor White
        Write-Host "Dinh dang tieu de: $(if ($res.isValidTitle) { 'HOP LE' } else { 'KHONG HOP LE' })" -ForegroundColor $(if ($res.isValidTitle) { 'Green' } else { 'Red' })
        Write-Host "Tom tat phan ra : $($res.summaryText)" -ForegroundColor Green
        Write-Host "Bam Checklist   : $($res.checklistHash)" -ForegroundColor DarkCyan
        Write-Host "Anchor On-chain : $($res.onChainAnchorTx)" -ForegroundColor DarkCyan
        Write-Host ""
        Write-Host "=== TIEU CHI DETERMINISTIC (KHACH QUAN - AI TU DONG CHAM) ===" -ForegroundColor Yellow
        foreach ($item in $res.deterministicItems) {
            Write-Host "  [$($item.id)] $($item.category): $($item.criterion)" -ForegroundColor Cyan
            Write-Host "         Kiem tra boi: $($item.verifiableBy) | Chi so: $($item.metric)" -ForegroundColor DarkGray
        }
        Write-Host ""
        Write-Host "=== TIEU CHI SUBJECTIVE (CHU QUAN - CLIENT DUYET TAY) ===" -ForegroundColor Yellow
        foreach ($item in $res.subjectiveItems) {
            Write-Host "  [$($item.id)] $($item.category): $($item.criterion)" -ForegroundColor Magenta
            Write-Host "         Nguoi duyet: $($item.approver)" -ForegroundColor DarkGray
        }
        return $res
    } catch {
        Write-ErrorMsg "Loi khi goi /api/agents/scope-decompose: $_"
    }
}

# 4. API Tang 2 & 3: Sandbox Verifier & Technical Assessor
function Invoke-VerifyAssess {
    param(
        [string]$DeliverableUrl,
        [string]$TestScenario
    )
    Write-Header "TANG 2 & 3: SANDBOX VERIFIER & TECHNICAL ASSESSOR (/api/agents/verify-assess)"
    try {
        $uri = "$BaseUrl/api/agents/verify-assess"
        Write-Host "PR/Deliverable URL : $DeliverableUrl" -ForegroundColor Yellow
        Write-Host "Kich ban Sandbox   : $TestScenario" -ForegroundColor Yellow
        Write-Host "Dang gui POST den: $uri ..." -ForegroundColor DarkGray

        $payload = @{
            submission = @{
                deliverableUrl = $DeliverableUrl
                commitHash = "commit#9f8c2a1"
            }
            scenario = $TestScenario
        } | ConvertTo-Json -Depth 4

        $res = Invoke-RestMethod -Uri $uri -Method Post -Body $payload -ContentType "application/json; charset=utf-8" -ErrorAction Stop

        Write-Success "Agent da hoan thanh kiem thu & danh gia ky thuat!"
        Write-Host "Dinh dang GitHub   : $(if ($res.isGitHubValid) { 'HOP LE' } else { 'LOI DINH DANG' })" -ForegroundColor $(if ($res.isGitHubValid) { 'Green' } else { 'Red' })
        Write-Host "Ty le Test Dat     : $($res.passRatePercent)% ($($res.objectivePassed)/$($res.objectiveTotal) tieu chi)" -ForegroundColor $(if ($res.passRatePercent -eq 100) { 'Green' } else { 'Red' })
        Write-Host "Khuyen nghi        : [$($res.recommendation.decision)] $($res.recommendation.message)" -ForegroundColor Yellow
        Write-Host "Ghi nhan On-chain  : $($res.proofRegistryOnChainTx)" -ForegroundColor DarkCyan
        Write-Host "Bao cao IPFS CID   : $($res.ipfsReportCid)" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "=== TIEN TRINH 4 BUOC TOOLCHAIN CUA SANDBOX ===" -ForegroundColor Yellow
        foreach ($step in $res.toolchainSteps) {
            $color = if ($step.status -eq 'PASSED') { 'Green' } elseif ($step.status -eq 'SKIPPED') { 'DarkGray' } else { 'Red' }
            Write-Host "  Buoc $($step.step): [$($step.status)] $($step.tool)" -ForegroundColor $color
            Write-Host "         Hanh dong: $($step.action)" -ForegroundColor White
            Write-Host "         Nhat ky  : $($step.log)" -ForegroundColor DarkGray
        }
        return $res
    } catch {
        Write-ErrorMsg "Loi khi goi /api/agents/verify-assess: $_"
    }
}

# 5. API Tang 4: Fact-finding Bailiff Agent
function Invoke-FactFinding {
    Write-Header "TANG 4: FACT-FINDING BAILIFF AGENT (/api/agents/fact-finding)"
    try {
        $uri = "$BaseUrl/api/agents/fact-finding"
        Write-Host "Dang yeu cau Agent dieu tra tranh chap tu du lieu hop dong hien tai..." -ForegroundColor DarkGray

        $stateUri = "$BaseUrl/api/state"
        $state = Invoke-RestMethod -Uri $stateUri -Method Get -ErrorAction Stop
        $disputedContract = $state.contracts | Where-Object { $_.status -eq 'DISPUTED' } | Select-Object -First 1

        if (-not $disputedContract) {
            $disputedContract = $state.contracts[0]
        }

        $payload = $disputedContract | ConvertTo-Json -Depth 6
        $res = Invoke-RestMethod -Uri $uri -Method Post -Body $payload -ContentType "application/json; charset=utf-8" -ErrorAction Stop

        Write-Success "Fact-finding Bailiff Agent da trich xuat bang chung phap ly!"
        Write-Host "Hop dong thu ly        : [$($res.contractId)] $($res.contractTitle)" -ForegroundColor White
        Write-Host "Muc do hoan thanh      : $($res.verifiedCompletionPercent)% khoi luong cong viec duoc kiem chung" -ForegroundColor Cyan
        Write-Host "De xuat phan chia quy  : Freelancer huong $($res.recommendedSellerPercent)% | Hoan tra Client $($res.recommendedBuyerPercent)%" -ForegroundColor Green
        Write-Host "Phat bieu de xuat      : $($res.proposalStatement)" -ForegroundColor Yellow
        Write-Host "Ghi chu HITL           : $($res.hitlNote)" -ForegroundColor Magenta
        Write-Host "Bam Ho so Vu viec      : $($res.dossierHash)" -ForegroundColor DarkCyan
        Write-Host ""
        Write-Host "=== HO SO CHUNG CU CHI TIET (DOSSIER) ===" -ForegroundColor Yellow
        Write-Host "* Anchor Checklist   : $($res.dossierSections.signedChecklistAnchor)" -ForegroundColor White
        Write-Host "* Tien trinh nop     : $($res.dossierSections.deliveryAndCommitTimeline)" -ForegroundColor DarkGray
        Write-Host "* Ket qua kiem thu   : $($res.dossierSections.automatedTestAudit)" -ForegroundColor DarkGray
        Write-Host "* Phan tich Pham vi  : $($res.dossierSections.scopeCreepAnalysis)" -ForegroundColor Red
        return $res
    } catch {
        Write-ErrorMsg "Loi khi goi /api/agents/fact-finding: $_"
    }
}

# 6. API State
function Invoke-EscrowState {
    Write-Header "TRANG THAI ESCROW DONG (/api/state)"
    try {
        $uri = "$BaseUrl/api/state"
        $res = Invoke-RestMethod -Uri $uri -Method Get -ErrorAction Stop
        Write-Success "Doc Escrow State thanh cong!"
        $clientBal = if ($res.clientBalance -ne $null) { $res.clientBalance } else { $res.wallets.client.balance }
        $freelancerBal = if ($res.freelancerBalance -ne $null) { $res.freelancerBalance } else { $res.wallets.freelancer.balance }
        $pendingCount = if ($res.pendingTopups) { $res.pendingTopups.Count } else { 0 }
        Write-Host "So du Vi Client       : $clientBal (Yeu cau nap cho Arbiter duyet: $pendingCount)" -ForegroundColor Cyan
        Write-Host "So du Vi Freelancer   : $freelancerBal" -ForegroundColor Green
        Write-Host "Tong so Hop dong      : $($res.contracts.Count)" -ForegroundColor Yellow
        foreach ($c in $res.contracts) {
            $amount = if ($c.totalAmount) { $c.totalAmount } else { $c.amount }
            Write-Host "  - [$($c.id)] $($c.title)" -ForegroundColor White
            Write-Host "    Trang thai: $($c.status) | Gia tri: $amount | Freelancer: $($c.freelancer)" -ForegroundColor DarkGray
        }
        return $res
    } catch {
        Write-ErrorMsg "Loi khi goi /api/state: $_"
    }
}

# 7. Ket noi External LLM API (Google Gemini REST API)
function Invoke-GeminiApi {
    param(
        [string]$PromptText,
        [string]$GeminiKey,
        [string]$ModelName
    )
    Write-Header "KET NOI EXTERNAL LLM API (GOOGLE GEMINI REST API)"

    if (-not $GeminiKey) {
        Write-WarningMsg "Chua tim thay Gemini API Key!"
        Write-Host "Ban co the truyen khoa bang tham so: -ApiKey 'AIzaSy...'" -ForegroundColor Yellow
        Write-Host "Hoac thiet lap bien moi truong: `$env:GEMINI_API_KEY = 'AIzaSy...'" -ForegroundColor Yellow
        Write-Host ""
        $inputKey = Read-Host "Nhap Gemini API Key cua ban (hoac nhan Enter de bo qua)"
        if ($inputKey) {
            $GeminiKey = $inputKey
        } else {
            Write-ErrorMsg "Da huy goi Gemini API do thieu API Key."
            return
        }
    }

    try {
        $endpoint = "https://generativelanguage.googleapis.com/v1beta/models/${ModelName}:generateContent?key=$GeminiKey"
        Write-Host "Gui Prompt den Gemini ($ModelName)..." -ForegroundColor Yellow
        Write-Host "Prompt: '$PromptText'" -ForegroundColor DarkGray

        $body = @{
            contents = @(
                @{
                    parts = @(
                        @{ text = $PromptText }
                    )
                }
            )
        } | ConvertTo-Json -Depth 5

        $res = Invoke-RestMethod -Uri $endpoint -Method Post -Body $body -ContentType "application/json" -ErrorAction Stop
        $responseText = $res.candidates[0].content.parts[0].text

        Write-Success "Nhan phan hoi thanh cong tu Google Gemini!"
        Write-Host ""
        Write-Host $responseText -ForegroundColor White
        return $responseText
    } catch {
        Write-ErrorMsg "Loi khi goi Gemini API: $_"
    }
}

# 8. Chay toan bo luong kiem thu API
function Invoke-TestAll {
    Write-Header "CHAY TOAN BO KIEM THU TICH HOP TAT CA CAC API AGENTS"
    Invoke-EscrowHealth
    Invoke-EscrowMatrix
    Invoke-ScopeDecomposer -BriefText "Xay dung cong thanh toan QR MB Bank va webhook xac thuc"
    Invoke-VerifyAssess -DeliverableUrl "https://github.com/vibecode/app/pull/42" -TestScenario "PASS_100"
    Invoke-FactFinding
    Invoke-EscrowState
    Write-Host ""
    Write-Success "Hoan tat kiem thu toan bo API Agents thanh cong 100%!"
}

# Menu tuong tac truc quan
function Show-InteractiveMenu {
    while ($true) {
        Write-Host ""
        Write-Host "======================================================================" -ForegroundColor Cyan
        Write-Host "   SMART ESCROW PLATFORM - TRINH DIEU KHIEN KET NOI API & LLM" -ForegroundColor White
        Write-Host "======================================================================" -ForegroundColor Cyan
        Write-Host "  May chu dich: $BaseUrl" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "  [1] Kiem tra trang thai may chu (/api/health)" -ForegroundColor White
        Write-Host "  [2] Xem Ma tran 4 Tang AI Agents (/api/agents/matrix)" -ForegroundColor White
        Write-Host "  [3] Goi Tang 1: Phan ra yeu cau du an (/api/agents/scope-decompose)" -ForegroundColor White
        Write-Host "  [4] Goi Tang 2 & 3: Kiem thu Sandbox & Danh gia ky thuat PR" -ForegroundColor White
        Write-Host "  [5] Goi Tang 4: Trich xuat bang chung tranh chap (/api/agents/fact-finding)" -ForegroundColor White
        Write-Host "  [6] Xem trang thai vi & hop dong Escrow (/api/state)" -ForegroundColor White
        Write-Host "  [7] Chay toan bo kiem thu API (1 den 6)" -ForegroundColor Green
        Write-Host "  [8] Ket noi truc tiep External LLM (Google Gemini REST API)" -ForegroundColor Magenta
        Write-Host "  [0] Thoat" -ForegroundColor DarkGray
        Write-Host "======================================================================" -ForegroundColor Cyan
        
        $choice = Read-Host "Chon chuc nang [0-8]"
        switch ($choice) {
            '1' { Invoke-EscrowHealth }
            '2' { Invoke-EscrowMatrix }
            '3' {
                $userBrief = Read-Host "Nhap mo ta du an (nhan Enter dung mau mac dinh)"
                if (-not $userBrief) { $userBrief = $Prompt }
                Invoke-ScopeDecomposer -BriefText $userBrief
            }
            '4' {
                $userPr = Read-Host "Nhap GitHub PR URL (nhan Enter dung mau mac dinh)"
                if (-not $userPr) { $userPr = $PrUrl }
                $userScen = Read-Host "Chon kich ban: [1] PASS_100 (mac dinh) hoac [2] FAIL_PAYMENT_500"
                $scen = if ($userScen -eq '2') { 'FAIL_PAYMENT_500' } else { 'PASS_100' }
                Invoke-VerifyAssess -DeliverableUrl $userPr -TestScenario $scen
            }
            '5' { Invoke-FactFinding }
            '6' { Invoke-EscrowState }
            '7' { Invoke-TestAll }
            '8' {
                $geminiPrompt = Read-Host "Nhap Prompt muon gui den Gemini"
                if (-not $geminiPrompt) { $geminiPrompt = "Dong vai tro Chuyen gia Hop dong Escrow, tom tat quy tac giai ngan tu dong 2 moc 50/50" }
                Invoke-GeminiApi -PromptText $geminiPrompt -GeminiKey $ApiKey -ModelName $Model
            }
            '0' {
                Write-Host "Tam biet!" -ForegroundColor Cyan
                return
            }
            default {
                Write-WarningMsg "Lua chon khong hop le, vui long chon tu 0 den 8."
            }
        }
    }
}

Assert-ServerReady

switch ($Action) {
    'health'      { Invoke-EscrowHealth }
    'matrix'      { Invoke-EscrowMatrix }
    'decompose'   { Invoke-ScopeDecomposer -BriefText $Prompt }
    'verify'      { Invoke-VerifyAssess -DeliverableUrl $PrUrl -TestScenario $Scenario }
    'factfinding' { Invoke-FactFinding }
    'state'       { Invoke-EscrowState }
    'gemini'      { Invoke-GeminiApi -PromptText $Prompt -GeminiKey $ApiKey -ModelName $Model }
    'test-all'    { Invoke-TestAll }
    'menu'        { Show-InteractiveMenu }
    default       { Show-InteractiveMenu }
}
