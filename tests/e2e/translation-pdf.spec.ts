"/**\n * E2E: AI 플랜 번역 + PDF 다운로드 흐름 테스트\n *\n * 테스트 흐름:\n *   1. 플랜 상세 페이지 접속\n *   2. 언어 전환 (ko → en) 시 번역 API 호출 확인\n *   3. 번역 중 PDF 버튼 비활성화 확인\n *   4.
<truncated 4932 bytes>
"  test('language switch triggers translation and blocks PDF', async ({ page }) => {\n    await page.goto(TEST_PLAN_PATH, { waitUntil: 'load' });\n\n    // Check page loaded (plan content visible)"
"  test('PDF download button exists and is clickable', async ({ page }) => {\n    await page.goto(TEST_PLAN_PATH, { waitUntil: 'load' });\n\n    // Navigate to outro slide (swipe to last slide)"
"  test('language selection persists across navigation', async ({ page }) => {\n    await page.goto('/', { waitUntil: 'load' });\n\n    const langSelector = page.locator('select[data-testid=\"language-selector\"], .language-selector select, header select')
<truncated 301 bytes>
"const TEST_PLAN_PATH = '/my-plans/5dc5dde1-7906-44ae-ba13-9b59154ce572';"
"    // Try Desktop custom language dropdown\n    const desktopLangBtn = page.locator('header button').filter({ hasText: /KO|EN|JA|ZH/ }).first();\n    let originalLang = 'KO';\n    \n    if (await desktopLangBtn.isVisible()) {\n      // Desktop\n      awa
<truncated 2829 bytes>
"import * as fs from 'fs';\nimport * as path from 'path';\n\n// 기존 공개 플랜 ID를 사용 (비로그인 접근 가능한 공개 플랜 필요)\n// 실제 테스트시 유효한 planId로 교체\nlet planId = '5dc5dde1-7906-44ae-ba13-9b59154ce572';\
"import { test, expect } from '@playwright/test';\nimport * as fs from 'fs';\nimport * as path from 'path';\n\n// 기존 공개 플랜 ID를 사용 (비로그인 접근 가능한 공개 플랜 필요)\n// 실제 테스트 시 유효한 planId로 교체\nle
<truncated 277 bytes>