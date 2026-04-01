# CocoTripKR - Google 서비스 계정 .env 자동 설정 스크립트
# 사용법: service-account.json을 완성한 후 이 스크립트를 실행하세요
# 실행: PowerShell에서 .\setup-google-auth.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$jsonPath  = Join-Path $scriptDir "service-account.json"
$envPath   = Join-Path $scriptDir ".env"

# ── 1. service-account.json 존재 확인 ──────────────────────────────
if (-not (Test-Path $jsonPath)) {
    Write-Host "❌ service-account.json 파일을 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "   프로젝트 루트에 service-account.json을 저장한 후 다시 실행하세요."
    exit 1
}

# ── 2. JSON 파싱 및 유효성 검사 ─────────────────────────────────────
$json = Get-Content $jsonPath -Raw | ConvertFrom-Json

if ($json.client_email -match "PASTE_" -or $json.private_key -match "PASTE_") {
    Write-Host "❌ service-account.json에 플레이스홀더가 남아있습니다." -ForegroundColor Red
    Write-Host "   Google Cloud Console에서 다운로드한 실제 JSON으로 교체하세요."
    exit 1
}

$clientEmail = $json.client_email
Write-Host "✅ 서비스 계정 이메일: $clientEmail" -ForegroundColor Green

# ── 3. base64 인코딩 ────────────────────────────────────────────────
$jsonBytes  = [System.Text.Encoding]::UTF8.GetBytes((Get-Content $jsonPath -Raw))
$base64Key  = [Convert]::ToBase64String($jsonBytes)
Write-Host "✅ base64 인코딩 완료 (길이: $($base64Key.Length) chars)" -ForegroundColor Green

# ── 4. .env 파일 업데이트 ────────────────────────────────────────────
$envContent = Get-Content $envPath -Raw

# GOOGLE_SERVICE_ACCOUNT_EMAIL 교체
$envContent = $envContent -replace "GOOGLE_SERVICE_ACCOUNT_EMAIL=.*", "GOOGLE_SERVICE_ACCOUNT_EMAIL=$clientEmail"

# GOOGLE_SERVICE_ACCOUNT_KEY 교체
$envContent = $envContent -replace "GOOGLE_SERVICE_ACCOUNT_KEY=.*", "GOOGLE_SERVICE_ACCOUNT_KEY=$base64Key"

Set-Content $envPath $envContent -NoNewline
Write-Host "✅ .env 파일 업데이트 완료!" -ForegroundColor Green

# ── 5. 완료 안내 ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host " 다음 단계: Google Sheets에서 서비스 계정 공유 설정" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host " 1. 구글 스프레드시트 열기"
Write-Host " 2. [공유] 버튼 클릭"
Write-Host " 3. 아래 이메일을 '편집자'로 추가:"
Write-Host "    $clientEmail" -ForegroundColor Yellow
Write-Host " 4. 시트 탭 이름이 '코코트립 예약 관리' 인지 확인"
Write-Host ""
Write-Host " Netlify 배포 시: 위 .env 값들을 Netlify 환경변수에도 동일하게 입력하세요."
Write-Host ""
