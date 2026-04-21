# ✅ 상용화 최종 점검 체크리스트 (웹 + 모바일)

**작성일**: 2026-04-21
**대상**: AG (최종 QA 세션)
**현재 커밋**: `3cb4d3f`
**범위**: 🚫 **신규 기능 추가 금지** — 기존 기능 검증/점검만

> 상용 개시 전 마지막 QA. 버그 발견 시 해당 항목에 ❌ + 상세 메모. 전 항목 ✅ 되면 상용 개시 가능.

---

## 🧪 테스트 환경 준비

### 필수 기기
- [ ] **iPhone Safari** (iOS 17+)
- [ ] **Android Chrome** (최신)
- [ ] **Desktop Chrome** (1920×1080)
- [ ] **Desktop Safari** (macOS)
- [ ] **iPad Safari** (tablet breakpoint)
- [ ] **Desktop Firefox** (호환성 스모크)

### 테스트 계정
- TAEO: `2001leety@gmail.com` (어드민, 505 coins, 쿠폰 2장)
- 신규 게스트 계정 (익명 경로 검증용)

---

# 📋 Section 1 — 언어 / i18n (🔴 치명 이슈 존재)

**배경**: `HANDOFF-ux-critical-fixes.md` BUG-1/BUG-2에서 확인된 실패 항목. **모바일에서도 동일 재현 여부 반드시 확인.**

## 1.1 언어 스위처 기본 동작
| 시나리오 | 웹 | 모바일 |
|----------|-----|--------|
| Header에서 ko→en 전환 | ☐ | ☐ |
| en→ja 전환 | ☐ | ☐ |
| ja→zh 전환 | ☐ | ☐ |
| zh→ko 복귀 | ☐ | ☐ |
| 브라우저 새로고침 후 언어 유지 | ☐ | ☐ |

## 1.2 각 페이지 i18n 완성도 (4개 언어 전부 확인)
| 페이지 | ko | en | ja | zh |
|--------|-----|-----|-----|-----|
| 홈 (HomePage) | ☐ | ☐ | ☐ | ☐ |
| 투어 리스트 (/tours) | ☐ | ☐ | ☐ | ☐ |
| 투어 상세 (/tours/:slug) | ☐ | ☐ | ☐ | ☐ |
| AI 플래너 위저드 (/planner) | ☐ | ☐ | ☐ | ☐ |
| **플랜 결과** (/my-plans/:id) | ✅ i18n 적용 | ✅ | ✅ | ✅ |
| MyPage 전체 탭 | ☐ | ☐ | ☐ | ☐ |
| Coupons 탭 (Redeem 섹션) | ☐ | ☐ | ☐ | ☐ |
| Reviews 탭 | ☐ | ☐ | ☐ | ☐ |
| ShareButton 토스트 | ☐ | ☐ | ☐ | ☐ |
| ReviewWriteModal | ☐ | ☐ | ☐ | ☐ |
| 푸터 (Terms/Privacy/About 링크) | ☐ | ☐ | ☐ | ☐ |
| 404 페이지 | ☐ | ☐ | ☐ | ☐ |
| 에러 메시지 (결제 실패 등) | ☐ | ☐ | ☐ | ☐ |

## 1.3 플랜 데이터 자체의 번역 (BUG-1)
- [x] 한국어로 플랜 생성 → en 전환 시 `display_name`/`tip` 영어로 변경 ✅ **Firestore 캐시 구현**
- [x] 동일 시나리오 ja/zh 확인 ✅
- [x] 기존 저장된 오래된 플랜도 언어 전환 정상 ✅ **온디맨드 번역**

---

# 📋 Section 2 — 정보 구조 (UX-1)

**배경**: 사용자 피드백 "페이지가 너무 많다, 호텔/비행기/차터는 홈에 있어야".

## 2.1 홈 랜딩 CTA 노출
| 항목 | 웹 | 모바일 |
|------|-----|--------|
| 호텔 예약 CTA 홈 노출 | ✅ Booking.com | ✅ |
| 비행기 예약 CTA 홈 노출 | ✅ Skyscanner | ✅ |
| 차터 예약 CTA 홈 노출 | ✅ /charter | ✅ |
| AI 플래너 CTA 홈 노출 | ✅ /planner | ✅ |
| 투어 CTA 홈 노출 | ✅ /tours | ✅ |

## 2.2 네비게이션 깊이
- [ ] 주요 기능 진입까지 최대 2클릭 이내인가
- [ ] 모바일 하단 탭 (`MobileBottomNav`) 주요 기능 포함
- [ ] 햄버거 메뉴가 과도한 서브메뉴로 복잡하지 않음

---

# 📋 Section 3 — AI 플래너 플로우

## 3.1 위저드 → 결제 → 생성
| 단계 | 웹 | 모바일 |
|------|-----|--------|
| 질문지 전 스텝 정상 진행 | ☐ | ☐ |
| 뒤로가기 시 입력값 유지 | ☐ | ☐ |
| PayPal 버튼 로드 | ☐ | ☐ |
| 결제 완료 후 로딩 상태 표시 | ☐ | ☐ |
| Gemini 응답 대기 중 UX (스피너/프로그레스) | ☐ | ☐ |
| 생성 실패 시 에러 메시지 + 환불 안내 | ☐ | ☐ |

## 3.2 TEST 계정 바이패스
- [ ] `2001leety@gmail.com` 로그인 시 TEST 프리픽스로 PayPal 스킵 작동

## 3.3 플랜 품질 (validate-planner.js 기준)
- [ ] 총 이슈 9건 이하 유지
- [ ] `bad_address_prefix` 0건
- [ ] `language_mismatch` 1건 이하

## 3.4 플랜 결과 페이지
| 요소 | 웹 | 모바일 |
|------|-----|--------|
| Day 탭 전환 | ☐ | ☐ |
| 지도 링크 (네이버맵) 정상 오픈 | ☐ | ☐ |
| T-money 요금 표시 | ☐ | ☐ |
| 교통 소요 시간 표시 | ☐ | ☐ |
| 팁(`tip`) 텍스트 렌더 | ☐ | ☐ |
| 공유 버튼 작동 | ☐ | ☐ |
| **PDF 다운로드** (백지 아님) | ☐ | ☐ |
| PDF 한글 폰트 깨지지 않음 | ☐ | ☐ |

---

# 📋 Section 4 — 투어 예약 플로우

## 4.1 투어 리스트
| 항목 | 웹 | 모바일 |
|------|-----|--------|
| 투어 카드 이미지 로딩 | ☐ | ☐ |
| 가격 표시 통화 전환 (USD/KRW) | ☐ | ☐ |
| 필터/정렬 작동 | ☐ | ☐ |

## 4.2 투어 상세 → 예약
| 항목 | 웹 | 모바일 |
|------|-----|--------|
| 날짜 선택 달력 | ☐ | ☐ |
| 인원 선택 | ☐ | ☐ |
| 가용성 체크 (check-availability) 호출 | ☐ | ☐ |
| 쿠폰 코드 적용 | ☐ | ☐ |
| PayPal 결제 완료 | ☐ | ☐ |
| 예약 확인 이메일 수신 | ☐ | ☐ |
| 예약 내역 MyPage 반영 | ☐ | ☐ |

## 4.3 리뷰 섹션 (TourDetailPage)
- [ ] 리뷰 목록 정상 렌더 (웹/모바일)
- [ ] "리뷰 작성" 버튼 예약자만 노출
- [ ] 평균 별점 표시

---

# 📋 Section 5 — 결제 시스템

## 5.1 PayPal Live 모드
| 항목 | 웹 | 모바일 |
|------|-----|--------|
| 일반 사용자 실결제 성공 | ☐ | ☐ |
| 결제 취소 시 환불 처리 | ☐ | ☐ |
| 네트워크 끊김 시 에러 핸들링 | ☐ | ☐ |

## 5.2 PayPal Sandbox 모드
| 항목 | 웹 | 모바일 |
|------|-----|--------|
| TEST 계정 바이패스 정상 | ☐ | ☐ |
| 샌드박스 계정 실결제 성공 | ☐ | ☐ |
| **쿠폰 `isUsed` 마킹** | ✅ capturePaypalOrder.js | ✅ |
| 동일 쿠폰 재사용 차단 | ✅ applyPromoCode.js isUsed==false 검증 | ✅ |

## 5.3 환율
- [ ] USD → KRW 실시간 환율 조회 정상
- [ ] 환율 >1350 시 1350 cap 적용
- [ ] 환율 API 실패 시 fallback 1350 적용

## 5.4 used_paypal_orders (중복 방지)
- [x] 동일 orderId 재호출 시 차단 ✅ **used_paypal_orders 선점 방식**
- [x] Firestore에 orderId 기록됨 ✅

---

# 📋 Section 6 — 로열티 시스템

## 6.1 Trip Coins
| 시나리오 | 웹 | 모바일 |
|---------|-----|--------|
| 결제 후 코인 적립 (티어별 1%/1.5%/2%/3%) | ☐ | ☐ |
| 공유 시 +20P (ShareButton) | ☐ | ☐ |
| 동일 플랜 재공유 시 중복 차단 | ☐ | ☐ |
| 리뷰 작성 시 +50P | ☐ | ☐ |
| 헤더 배지 잔액 실시간 업데이트 | ☐ | ☐ |

## 6.2 쿠폰 교환 (Redeem)
| 시나리오 | 웹 | 모바일 |
|---------|-----|--------|
| 500코인 → $5 OFF | ☐ | ☐ |
| 1000코인 → $10 OFF | ☐ | ☐ |
| 2000코인 → $25 OFF (+25% 보너스) | ☐ | ☐ |
| 잔액 부족 시 버튼 비활성 | ☐ | ☐ |
| 교환 후 코드 클립보드 자동 복사 | ☐ | ☐ |
| usdValue 클라이언트 조작 시 서버 거부 | ☐ | ☐ |

## 6.3 Points History
- [ ] earn-share, redeem-coupon, earn 전부 이력 표시
- [ ] 음수(차감) / 양수(적립) 구분 시각적 명확

---

# 📋 Section 7 — 공유 / SNS

## 7.1 ShareButton
| 항목 | 웹 | 모바일 |
|------|-----|--------|
| 공유 모달 열림 | ☐ | ☐ |
| 링크 복사 성공 토스트 | ☐ | ☐ |
| 모바일 네이티브 share sheet (iOS/Android) | ☐ | ☐ |
| 공유 후 +20P 토스트 | ☐ | ☐ |

## 7.2 OG 이미지 (실전 공유 테스트)
| 플랫폼 | 썸네일 렌더 | 제목/설명 |
|--------|------------|-----------|
| Facebook | ☐ | ☐ |
| Twitter/X | ☐ | ☐ |
| KakaoTalk | ☐ | ☐ |
| LINE | ☐ | ☐ |
| WeChat | ☐ | ☐ |
| LinkedIn | ☐ | ☐ |
| WhatsApp | ☐ | ☐ |
| Discord | ☐ | ☐ |

**주의**: OG 이미지를 webp → PNG로 전환 완료 (og-image.png). Facebook/Kakao 호환 ✅

## 7.3 공유된 플랜 열람 (비로그인)
- [ ] 비로그인 사용자가 공유 URL 접근 가능
- [ ] 비공개 플랜은 접근 차단
- [ ] OG 메타태그 서버 사이드 렌더 여부

---

# 📋 Section 8 — 리뷰 시스템

## 8.1 작성 플로우
| 항목 | 웹 | 모바일 |
|------|-----|--------|
| ReviewWriteModal 오픈 | ☐ | ☐ |
| 별점 인터랙션 (터치 대응) | ☐ | ☐ |
| 500자 제한 카운터 | ☐ | ☐ |
| 제출 후 +50P 토스트 | ☐ | ☐ |
| 중복 작성 시 차단 | ☐ | ☐ |
| 소유자 본인 플랜 작성 차단 | ☐ | ☐ |

## 8.2 표시
| 항목 | 웹 | 모바일 |
|------|-----|--------|
| PlanDetailPage 리뷰 섹션 렌더 | ☐ | ☐ |
| TourDetailPage 리뷰 섹션 렌더 | ☐ | ☐ |
| 평균 별점 계산 정확 | ☐ | ☐ |
| 페이지네이션 작동 | ☐ | ☐ |
| MyPage Reviews 탭 내 리뷰 목록 | ☐ | ☐ |
| "View plan" 링크 정상 이동 | ☐ | ☐ |

## 8.3 관리
- [ ] 작성자 본인 삭제 가능
- [ ] 신고(report) 액션 작동
- [ ] 어드민 삭제 가능

---

# 📋 Section 9 — 인증 / 계정

## 9.1 로그인
| 항목 | 웹 | 모바일 |
|------|-----|--------|
| Google 로그인 | ☐ | ☐ |
| 로그아웃 | ☐ | ☐ |
| 세션 유지 (새로고침 후) | ☐ | ☐ |
| 보호 라우트 접근 시 로그인 유도 | ☐ | ☐ |

## 9.2 MyPage
| 탭 | 웹 | 모바일 |
|-----|-----|--------|
| Profile | ☐ | ☐ |
| My Trips | ☐ | ☐ |
| Points History | ☐ | ☐ |
| Coupons | ☐ | ☐ |
| Reviews | ☐ | ☐ |
| My Plans | ☐ | ☐ |

---

# 📋 Section 10 — 성능 / 안정성

## 10.1 초기 로딩 속도
| 페이지 | 웹 (3G 시뮬레이션) | 모바일 실망 |
|--------|-------------------|-------------|
| 홈 LCP | ☐ <2.5s | ☐ |
| 투어 리스트 | ☐ <3s | ☐ |
| 플랜 결과 | ☐ <3s | ☐ |

## 10.2 Lighthouse 점수 (Desktop)
- [ ] Performance ≥ 70
- [ ] Accessibility ≥ 90
- [ ] Best Practices ≥ 90
- [ ] SEO ≥ 90

## 10.3 Lighthouse 점수 (Mobile)
- [ ] Performance ≥ 50 (모바일은 기준 낮춤)
- [ ] Accessibility ≥ 90
- [ ] Best Practices ≥ 90
- [ ] SEO ≥ 90

## 10.4 번들 크기 확인
- [x] 메인 청크 <500KB gzip ✅ (최대 34KB gzip)
- [x] 500KB 초과 경고 없음 ✅

## 10.5 에러 핸들링
- [ ] API 500 에러 시 사용자 친화 메시지
- [ ] 네트워크 오프라인 감지 + 안내
- [ ] 콘솔 에러 0건 (또는 의도된 것만)

---

# 📋 Section 11 — 보안

## 11.1 Firestore Rules
- [ ] `test-firestore-rules-hardening.mjs` 10/10 PASS
- [x] 리뷰 규칙 테스트 ✅ **create/update 양쪽 rating+text 검증 강화**
- [ ] 로그인 안 한 사용자 남의 비공개 플랜 접근 차단
- [x] `used_paypal_orders` 직접 접근 차단 ✅ `allow read, write: if false`
- [x] `api_stats` 직접 접근 차단 ✅
- [x] `availability` 직접 접근 차단 ✅

## 11.2 API 보안
- [ ] GET 메서드로 POST 엔드포인트 호출 시 405
- [ ] 인증 필요 엔드포인트 비로그인 접근 차단
- [ ] Rate Limiting 여부 (현재 미구현)

## 11.3 XSS / Injection
- [ ] 리뷰 text 스크립트 삽입 시 escape 처리
- [ ] 플랜 display_name 스크립트 삽입 시 escape
- [ ] URL 파라미터 SQL 패턴 안전

## 11.4 민감 정보
- [ ] 콘솔에 API 키 노출 없음 (console.log)
- [ ] 소스맵에서 서버 시크릿 유출 없음
- [ ] `.env.local` 커밋 여부 확인

## 11.5 npm audit
- [ ] critical 0건 (현재 ✅)
- [ ] high 0건 (현재 ✅)

---

# 📋 Section 12 — SEO / 발견 가능성

## 12.1 메타 태그
- [ ] 홈 `<title>` 최적화
- [ ] 각 페이지 고유 `<title>`
- [ ] `<meta name="description">` 각 페이지
- [ ] `<link rel="canonical">` 적용

## 12.2 Open Graph
- [ ] 10개 `og:` 태그 존재 (감사 확인됨)
- [ ] 4개 `twitter:` 태그 존재
- [ ] 각 페이지별 고유 OG 이미지

## 12.3 sitemap / robots
- [ ] `sitemap.xml` 존재 및 접근 가능
- [ ] `robots.txt` 존재
- [ ] Google Search Console 등록됨

## 12.4 Structured Data
- [ ] schema.org JSON-LD 적용 여부
- [ ] Tour 정보 schema
- [ ] Review schema (aggregate rating)

---

# 📋 Section 13 — 법무 / 컴플라이언스

## 13.1 필수 페이지 존재 확인
| 항목 | 존재 | 최신 내용 |
|------|------|-----------|
| Terms of Service (영문) | ☐ | ☐ |
| Privacy Policy (영문) | ☐ | ☐ |
| Refund Policy | ☐ | ☐ |
| Travel Terms | ☐ | ☐ |

## 13.2 사업자 정보 (footer)
- [ ] 상호
- [ ] 대표자명
- [ ] 사업자등록번호
- [ ] 주소
- [ ] 연락처 (이메일)
- [ ] 통신판매업신고번호 (해당 시)

## 13.3 쿠키 / 개인정보
- [ ] 쿠키 동의 배너 (EU IP 노출)
- [ ] 개인정보 수집 동의 체크박스 (회원가입)

## 13.4 결제 고지
- [ ] 결제 화면 최종 금액 명시 (세금/수수료 포함 여부)
- [ ] 환불 조건 결제 전 노출

---

# 📋 Section 14 — 운영 / 모니터링

## 14.1 현재 상태
- [ ] Sentry (또는 동급) 에러 추적 설치 여부
- [ ] Uptime 모니터링 설치 여부
- [ ] Vercel 배포 알림 (Slack/이메일)
- [ ] Firestore 쿼터 알림 설정

## 14.2 백업 / 롤백
- [ ] Firestore 자동 백업 활성화 여부
- [ ] 직전 Vercel 배포로 1클릭 롤백 가능 확인
- [ ] `firestore.rules.preHardening` 백업 존재 ✅

## 14.3 고객 지원
- [ ] `support@cocotripkr.com` (또는 지정 이메일) 수신 가능
- [ ] 응답 SLA 정의 (예: 24시간 내)
- [ ] FAQ 페이지 존재

## 14.4 GA4
- [ ] GA4 측정 ID 주입 확인
- [ ] 주요 이벤트 수집 확인
  - [ ] `page_view`
  - [ ] `plan_purchase`
  - [ ] `tour_booking`
  - [ ] `share_click`
  - [ ] `signup`
  - [ ] `review_create`

---

# 📋 Section 15 — 모바일 전용 체크

## 15.1 뷰포트 / 반응형
- [ ] `<meta name="viewport">` 정상 (초기 줌 1.0, user-scalable 허용)
- [ ] 가로 스크롤 발생 안 함 (모든 페이지)
- [ ] 768px 미만에서 MobileBottomNav 노출
- [ ] 769px 이상에서 Desktop Header 노출

## 15.2 터치 UX
- [ ] 터치 영역 최소 44×44px
- [ ] 링크/버튼 간격 충분 (오터치 방지)
- [ ] 스와이프 제스처 의도된 곳에서만 작동
- [ ] 핀치 줌 의도치 않게 막히지 않음

## 15.3 iOS 특화
- [ ] Safari PDF 다운로드 작동 (Share Sheet 통해)
- [ ] 입력 시 자동 확대 방지 (`font-size: 16px` 이상)
- [ ] Safe Area 대응 (노치 디자인)
- [ ] Sticky CTA bar 키보드와 충돌 안 함

## 15.4 Android 특화
- [ ] Chrome 주소창 숨김/노출 시 레이아웃 깨짐 없음
- [ ] 뒤로가기 버튼 의도된 동작
- [ ] 키보드 올라올 때 모달 가려지지 않음

## 15.5 모바일 네트워크
- [ ] 3G 환경에서 초기 로딩 <5초
- [ ] 이미지 lazy loading 작동
- [ ] 오프라인 시 적절한 안내

---

# 📋 Section 16 — 크로스 브라우저 / 기기

## 16.1 브라우저별 스모크
| 브라우저 | 홈 | 플래너 | 결제 | 플랜 결과 |
|----------|-----|--------|------|-----------|
| Chrome | ☐ | ☐ | ☐ | ☐ |
| Safari | ☐ | ☐ | ☐ | ☐ |
| Firefox | ☐ | ☐ | ☐ | ☐ |
| Edge | ☐ | ☐ | ☐ | ☐ |
| Samsung Internet | ☐ | ☐ | ☐ | ☐ |

## 16.2 해상도
- [ ] 320px (iPhone SE 구형)
- [ ] 375px (iPhone 표준)
- [ ] 414px (iPhone Plus)
- [ ] 768px (iPad portrait)
- [ ] 1024px (iPad landscape)
- [ ] 1440px (Desktop 표준)
- [ ] 1920px (Desktop FHD)
- [ ] 2560px (Desktop QHD)

---

# 📋 Section 17 — 환경변수 / 설정

## 17.1 Vercel Production 환경변수 존재 확인
- [ ] `GEMINI_API_KEY`
- [ ] `GOOGLE_SERVICE_ACCOUNT_KEY`
- [ ] `PAYPAL_CLIENT_ID` / `PAYPAL_SECRET` (Live)
- [ ] `PAYPAL_CLIENT_ID_SANDBOX` / `PAYPAL_SECRET_SANDBOX`
- [ ] `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET`
- [ ] `ODSAY_API_KEY`
- [ ] `VITE_FIREBASE_API_KEY` + 5종
- [ ] `VITE_GA_MEASUREMENT_ID`

## 17.2 도메인 / DNS
- [ ] `cocotripkr.com` HTTPS 리다이렉트
- [ ] `www.cocotripkr.com` → `cocotripkr.com` 통합
- [ ] SSL 인증서 유효 (Vercel 자동)
- [ ] HSTS 헤더 활성화

---

# 📋 Section 18 — 알려진 이월 이슈 재검증

## 18.1 P0 / P1 (감사 + 직전 핸드오프)
| # | 이슈 | 상태 |
|---|------|------|
| 1 | 플랜 결과 언어 전환 실패 (BUG-1/2) | ✅ 해결 (Firestore 캐시 + i18n + PDF) |
| 2 | 호텔/비행기/차터 홈 부재 (UX-1) | ✅ 해결 (3+2 카드 레이아웃) |
| 3 | 쿠폰 E2E isUsed 검증 | ✅ 해결 (capturePaypalOrder + applyPromoCode) |
| 4 | 리뷰 Rules 보안 테스트 보강 | ✅ 해결 (rating/text/tourSlug 검증) |
| 5 | earlybird/counter 문서 부재 | ✅ 해결 (docs/earlybird-counter-guide.md) |
| 6 | 번들 >500KB 경고 | ✅ 해결 (최대 gzip 34KB) |
| 7 | OG 이미지 webp 호환성 | ✅ 해결 (og-image.png 전환) |

---

# 🎯 QA 실행 순서 권장

```
Day 1 — 환경 준비 + 보안/인프라
  §17 환경변수 확인
  §11 보안 점검
  §14 모니터링/백업

Day 2 — 핵심 플로우 (웹)
  §3 AI 플래너
  §4 투어 예약
  §5 결제
  §6 로열티

Day 3 — 핵심 플로우 (모바일)
  §15 모바일 전용
  §3~§6 모바일에서 재확인

Day 4 — 언어/공유/리뷰
  §1 i18n 전수
  §7 공유 + OG
  §8 리뷰

Day 5 — 법무/SEO/성능
  §13 법무
  §12 SEO
  §10 성능

Day 6 — 크로스 브라우저 + 이월 이슈
  §16 브라우저별
  §18 이월 이슈 재검증

Day 7 — 최종 보고서 작성
  발견 이슈 전체 집계 + P0 수정 계획
```

---

# 📊 리포트 양식

AG는 점검 완료 후 다음 양식으로 `docs/QA-RESULT-YYYY-MM-DD.md` 작성:

```markdown
# 최종 QA 결과 — YYYY-MM-DD

## 요약
- 총 체크 항목: XX개
- PASS: XX개
- FAIL: XX개
- 스킵: XX개

## 🔴 즉시 수정 필요 (블로커)
1. [§1.3 BUG-1] 플랜 언어 전환 실패
2. ...

## 🟡 수정 권장 (비블로커)
1. ...

## 🟢 참고 사항
1. ...

## 스크린샷
(이슈별 스크린샷 첨부)
```

---

# 🚫 본 세션 금지 행동

1. **신규 기능 추가 금지** — 점검만 수행
2. **대규모 리팩터 금지** — 발견된 버그의 최소 수정만
3. **LOCKED 영역 수정 금지** (`PayPalBookingButton.tsx` L164~225)
4. **Firestore Rules 완화 금지**
5. **의존성 메이저 업그레이드 금지**

---

# 📚 참조 문서

| 문서 | 용도 |
|------|------|
| `docs/ROADMAP-ALL-PENDING.md` | 전체 잔여 작업 맵 |
| `docs/HANDOFF-ux-critical-fixes.md` | BUG-1/BUG-2/UX-1 상세 |
| `docs/AUDIT-2026-04-20.md` | 직전 감사 |
| `docs/HANDOFF-session-0420-sprint2.md` | 스프린트 2 완료 상태 |
| `CLAUDE.md` | 프로젝트 규칙 (LOCKED, 필드 스키마) |

---

**작성**: 2026-04-21
**총 체크 항목**: **약 250개** (18개 Section × 평균 14항목)
**예상 소요**: 5~7일 (AG 단독 + 사용자 실기기 테스트)
**완료 기준**: 18개 Section 전부 PASS 또는 이월 승인
