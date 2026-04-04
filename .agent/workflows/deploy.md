---
description: Build and deploy to Vercel production
---
// turbo-all

## Deploy to Production

1. Run local build to verify no errors:
```
npm run build
```

2. If build fails, check the error output. Common issues:
   - Unused imports/variables → remove them
   - Missing i18n keys → add to `src/i18n/index.ts` for all 4 languages
   - Type errors → fix TypeScript types

3. Stage and commit changes:
```
git add -A
git commit -m "feat: <description of changes>"
```

4. Push to GitHub:
```
git push
```

5. Deploy to Vercel production:
```
npx vercel --prod --yes
```

6. Wait for deployment to complete. Verify output shows:
   - `✅ Production: https://cocotrip-source-*.vercel.app`
   - `🔗 Aliased: https://cocotripkr.com`

7. Verify the live site by opening `https://cocotripkr.com` in a browser.

## Rollback (if needed)
```
npx vercel rollback --yes
```
