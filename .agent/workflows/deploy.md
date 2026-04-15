---
description: Build verification and deploy to Vercel production
---

## Deploy to Production

1. Run type check to verify no errors (무료, 빠름):
```
npx tsc --noEmit
```

2. If type check fails, fix the errors. Common issues:
   - Unused imports/variables → remove them
   - Missing i18n keys → add to `src/i18n/index.ts` for all 4 languages
   - Type errors → fix TypeScript types

3. (선택) 배포 직전 1회만 로컬 빌드 확인:
```
npm run build
```
> ⚠️ 빌드 비용 주의: 일상 검증은 `npx tsc --noEmit`만 사용

4. Stage and commit changes:
```
git add -A
git commit -m "feat: <description of changes>"
```

5. Push to GitHub (Vercel auto-deploy):
```
git push origin main
```
> ⚠️ git push는 모든 수정 완료 후 **1회만** (빌드 비용 절감)

6. Verify the live site by opening `https://cocotripkr.com` in a browser.

## Rollback (if needed)
```
npx vercel rollback --yes
```

