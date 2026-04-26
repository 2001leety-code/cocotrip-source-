/**
 * Vercel API Route: OG Image Generator
 * GET /api/og-image?planId=xxx&lang=ko|en|ja|zh
 *
 * Generates 1200×630 social sharing image for public plans.
 * Non-public plans → redirect to default homepage OG image.
 *
 * PII WHITELIST: Only tour_title, area, days are used. No other fields.
 */
import { ImageResponse } from '@vercel/og';
import { initAdminDb } from './_shared/firebase-admin.js';

// ── firebase-admin 초기화 (api/_shared/firebase-admin.js 재사용) ────────
const adminDb = initAdminDb('og-image');

// ── OG 타이틀 다국어 템플릿 ──────────────────────────────────────────────
const OG_TITLES = {
  ko: (area, days) => `${area} ${days}일 여행 플랜`,
  en: (area, days) => `${area} ${days}-Day Trip Plan`,
  ja: (area, days) => `${area} ${days}日間旅行プラン`,
  zh: (area, days) => `${area} ${days}天旅行计划`,
};

const DEFAULT_OG_IMAGE = 'https://cocotripkr.com/og-image.png';

export default async function handler(req, res) {
  try {
    const { planId, lang = 'en' } = req.query;

    if (!planId || !adminDb) {
      res.writeHead(302, { Location: DEFAULT_OG_IMAGE });
      return res.end();
    }

    // ── Firestore에서 plan 조회 ─────────────────────────────────────────
    const doc = await adminDb.collection('plans').doc(planId).get();
    if (!doc.exists) {
      res.writeHead(302, { Location: DEFAULT_OG_IMAGE });
      return res.end();
    }

    const plan = doc.data();

    // ── isPublic 체크: 비공개면 기본 이미지로 폴백 ─────────────────────
    if (plan.isPublic !== true) {
      res.writeHead(302, { Location: DEFAULT_OG_IMAGE });
      return res.end();
    }

    // ── PII 화이트리스트 (수정 2 강제) ─────────────────────────────────
    const safePlan = {
      tour_title: plan.itinerary?.tour_title || 'Korea Trip',
      area: plan.input?.area || 'Korea',
      days: plan.itinerary?.days?.length || 0,
    };
    // safePlan 외 필드는 아래 ImageResponse에서 절대 사용 금지

    const titleFn = OG_TITLES[lang] || OG_TITLES.en;
    const subtitle = titleFn(safePlan.area, safePlan.days);

    // ── 1200×630 이미지 생성 ────────────────────────────────────────────
    const imageResponse = new ImageResponse(
      {
        type: 'div',
        props: {
          style: {
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            background: 'linear-gradient(135deg, #0a0b14 0%, #1a1035 50%, #0a0b14 100%)',
            fontFamily: 'sans-serif',
          },
          children: [
            // CocoTrip logo text
            {
              type: 'div',
              props: {
                style: {
                  fontSize: 28,
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.4)',
                  marginBottom: 24,
                  letterSpacing: 4,
                },
                children: 'COCOTRIP',
              },
            },
            // Tour title
            {
              type: 'div',
              props: {
                style: {
                  fontSize: 52,
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, #B668FC, #FF6B9D)',
                  backgroundClip: 'text',
                  color: 'transparent',
                  textAlign: 'center',
                  maxWidth: '80%',
                  lineHeight: 1.2,
                },
                children: safePlan.tour_title,
              },
            },
            // Subtitle
            {
              type: 'div',
              props: {
                style: {
                  fontSize: 28,
                  color: 'rgba(255,255,255,0.6)',
                  marginTop: 20,
                },
                children: subtitle,
              },
            },
            // Bottom badge
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  gap: 12,
                  marginTop: 40,
                  alignItems: 'center',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        background: 'rgba(124,92,252,0.2)',
                        border: '1px solid rgba(124,92,252,0.3)',
                        borderRadius: 20,
                        padding: '8px 20px',
                        fontSize: 18,
                        color: '#B668FC',
                      },
                      children: 'AI Travel Planner',
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: {
                        fontSize: 18,
                        color: 'rgba(255,255,255,0.3)',
                      },
                      children: 'cocotripkr.com',
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      { width: 1200, height: 630 }
    );

    // ── 캐시 헤더 + 응답 ────────────────────────────────────────────────
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, s-maxage=31536000',
      'Content-Length': buffer.length,
    });
    return res.end(buffer);

  } catch (err) {
    console.error('[og-image] Error:', err.message);
    res.writeHead(302, { Location: DEFAULT_OG_IMAGE });
    return res.end();
  }
}
