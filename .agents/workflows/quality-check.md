---
description: 모든 작업 완료 후 필수 품질 검수 프로세스 (빌드 5회, 번역, 코드 검증)
---

# 필수 품질 검수 프로세스

모든 코드 변경 작업 완료 후, 아래 3단계를 **반드시** 수행한다.
배포(`vercel --prod`)는 사용자가 명시적으로 요청할 때만 진행한다.

---

## 1단계: 빌드 검수 5회
// turbo-all

```powershell
for ($i=1; $i -le 5; $i++) { $r = npm run build 2>&1; if ($LASTEXITCODE -ne 0) { Write-Output "BUILD $i FAILED"; $r | Select-String "error"; break } else { Write-Output "BUILD $i OK" } }; Write-Output "BUILD CHECK DONE"
```

- 5회 모두 `Exit code: 0` 이어야 통과
- 1회라도 실패 시 즉시 수정 후 다시 5회 반복

---

## 2단계: 번역 검수

모든 사용자 노출 텍스트가 올바른지 확인:

1. 한국어 하드코딩 텍스트가 영어/일본어/중국어 사용자에게 노출되지 않는지 확인
2. i18n `t.xxx` 키가 누락되지 않았는지 확인
3. 가격 표기가 USD($) 통일인지 확인

```powershell
# 번역 키 누락 검색 (t. 사용하는 파일에서 undefined 가능성)
Get-ChildItem -Path "src" -Recurse -Include "*.tsx" | ForEach-Object { $c = Get-Content $_.FullName -Raw -Encoding UTF8; if ($c -match 'undefined|\.xxx|TODO.*transl') { Write-Output "TRANSLATION CHECK: $($_.Name)" } }; Write-Output "TRANSLATION SCAN DONE"
```

---

## 3단계: 코드 검수

변경된 파일의 코드 품질 확인:

1. **색상 분리 확인**: PC 전용 파일에 모바일 컬러(`#B668FC`, `#FF6B9D`)가 누출되지 않았는지 스캔
2. **import 누락**: 사용하는 컴포넌트의 import가 모두 존재하는지 확인
3. **타입 에러**: TypeScript 에러 0건 확인

```powershell
# 모바일 색상이 PC 파일에 누출되었는지 확인
Get-ChildItem -Path "src" -Recurse -Include "*.tsx","*.css" | Where-Object { $_.Name -ne 'MobileHome.tsx' } | ForEach-Object { $c = Get-Content $_.FullName -Raw -Encoding UTF8; if ($c -match '#B668FC|#FF6B9D') { Write-Output "COLOR LEAK: $($_.Name)" } }; Write-Output "COLOR CHECK DONE"
```

---

## 최종 보고

3단계 모두 통과 후 사용자에게 결과 보고:

| 항목 | 결과 |
|---|---|
| 빌드 5/5 | ✅ / ❌ |
| 번역 검수 | ✅ / ❌ |
| 코드 검수 (색상 누출) | ✅ / ❌ |

**배포는 사용자가 "배포해" 라고 말할 때만 진행한다.**
