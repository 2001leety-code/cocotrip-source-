# Runbook — Google Wallet Pass 활성화

**상태:** 코드 완성, env 미설정 → silent skip 중
**관련 파일:** [api/_create-wallet-pass.js](../api/_create-wallet-pass.js), [api/booking-processor.js](../api/booking-processor.js) (Step 5)
**효과:** 결제 완료 → 확인 이메일에 "Add to Google Wallet" 링크 자동 첨부 → 고객 폰에서 탭 → 투어 당일 픽업 시 지갑 앱에서 QR 표시

PDF 바우처는 이미 활성 상태(env 불필요). 이 런북은 Google Wallet 추가만 다룸.

---

## 1. Google Cloud Console — Wallet API 신청 (1회)

1. https://console.cloud.google.com/google/maps-apis/api-list 접속 → 프로젝트 선택 (없으면 신규)
2. **APIs & Services → Library** → "Google Wallet API" 검색 → **Enable**
3. **APIs & Services → Google Wallet API → Wallet Console 이동** (신규 탭)
4. https://pay.google.com/business/console/ 에서 비즈니스 정보 입력 (CocoTripKR / 한국 / 사업자등록번호)
5. **Wallet API access 신청** — 영업일 1-3일 승인 대기

승인 완료되면 콘솔 좌측 상단에 **Issuer ID**(숫자, 예: `3388000000022xxxxxx`) 표시됨.

---

## 2. Generic Pass Class 생성 (1회)

[api/_create-wallet-pass.js:32](../api/_create-wallet-pass.js)이 사용하는 Generic Pass class를 미리 만들어둬야 함.

```bash
# 서비스 계정 토큰 발급 (단계 3 완료 후 가능)
ACCESS_TOKEN=$(gcloud auth print-access-token)
ISSUER_ID="3388000000022xxxxxx"  # 본인 ID로 교체
CLASS_ID="cocotrip-tour-voucher-v1"

curl -X POST \
  "https://walletobjects.googleapis.com/walletobjects/v1/genericClass" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"${ISSUER_ID}.${CLASS_ID}\",
    \"classTemplateInfo\": {
      \"cardTemplateOverride\": {
        \"cardRowTemplateInfos\": [{
          \"oneItem\": {
            \"item\": {
              \"firstValue\": {
                \"fields\": [{ \"fieldPath\": \"object.textModulesData['guest']\" }]
              }
            }
          }
        }]
      }
    }
  }"
```

→ `200 OK` 응답 확인. 한 번만 만들면 됨 (모든 패스가 이 class 참조).

---

## 3. 서비스 계정 생성 + 키 발급 (1회)

1. Google Cloud Console → **IAM & Admin → Service Accounts → Create Service Account**
2. Name: `cocotrip-wallet-signer`
3. Role: **Wallet Object Issuer** (또는 `Service Account Token Creator`)
4. 생성 후 → **Keys → Add Key → JSON → 다운로드**
5. JSON 파일을 base64 인코딩:
   ```bash
   base64 -i ~/Downloads/cocotrip-wallet-signer-xxx.json -o /tmp/sa-base64.txt
   # macOS: base64 -i ... > /tmp/sa-base64.txt
   # Windows PowerShell: [Convert]::ToBase64String([IO.File]::ReadAllBytes("...json")) > sa-base64.txt
   ```

---

## 4. Vercel env 등록

Vercel Dashboard → `cocotrip-source_2026` → **Settings → Environment Variables**

| Key | Value | Environment |
|---|---|---|
| `GOOGLE_WALLET_ISSUER_ID` | (단계 1의 숫자 ID) | Production |
| `GOOGLE_WALLET_CLASS_ID` | `cocotrip-tour-voucher-v1` | Production |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | (JSON `client_email` 값) | Production |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | (단계 3의 base64 문자열, 줄바꿈 없이) | Production |

→ **Redeploy** (Deployments → 최신 → Redeploy)

---

## 5. 검증

1. 테스트 예약 진행 (TEST 계정 `2001leety@gmail.com`)
2. Vercel Logs에서 `[create-wallet-pass] Wallet 링크 생성 완료` 확인
3. 고객 이메일 본문에 "Add to Google Wallet" 버튼 확인 → 탭 → Google Pay 앱에서 패스 저장됨

실패 시:
- `[create-wallet-pass] ISSUER_ID/CLASS_ID 미설정` → env 미반영, redeploy 안 됨
- `Wallet 생성 실패: ... 401` → 서비스 계정 권한 부족 또는 base64 인코딩 깨짐
- `Wallet 생성 실패: ... 404` → CLASS_ID 가 실제 생성된 class와 불일치

---

## 6. PII 주의

`api/_create-wallet-pass.js:62-69` `textModulesData`에 다음 PII가 들어감:
- `customerName` — 고객 이름
- `bookingRef` — 예약 번호

이는 Google Wallet 정책상 **본인의 패스에만 표시되며 Google이 제3자에게 공개하지 않음**. GDPR 처리는 Google 측에서 함. 추가 동의 불필요 (PayPal 결제 동의 약관에 포함).
