/**
 * CocoTripKR — Google Wallet 디지털 패스 생성
 *
 * Generic Pass (JWT) 방식 사용
 * 서비스 계정 private key로 RS256 서명 → pay.google.com/gp/v/save/{jwt} URL 반환
 *
 * CONTEXT: booking-processor.js에서 호출되는 유틸리티 (HTTP handler 없음)
 * ENV: GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_CLASS_ID,
 *      GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY
 *
 * NOTE: Google Wallet API 사전 승인 필요
 *       GOOGLE_WALLET_ISSUER_ID 미설정 시 null 반환 (graceful skip)
 */

import crypto from 'crypto';
import { Buffer } from 'buffer';

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signRS256JWT(header, payload, privateKey) {
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sign  = crypto.createSign('RSA-SHA256');
  sign.update(data);
  const sig = sign.sign(privateKey, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sig}`;
}

// 2026-05-04: charter_custom_estimate (zone-fallback) 예약은 ±10% 정산 약관 안내 필수.
// Google Wallet 의 LocalizedString 형식을 사용해 ko/en/ja/zh 4개 언어를 함께 동봉.
// 단말기 locale 에 맞는 언어가 자동 노출되며, fallback 은 defaultValue(en).
const RECONCILIATION_TITLE = {
  defaultValue: { language: 'en', value: 'Estimate-Based Pricing — Reconciliation Notice (+/-10%)' },
  translatedValues: [
    { language: 'ko', value: '추정가 결제 — 정산 안내 (±10%)' },
    { language: 'ja', value: '見積もりベース料金 — 精算のご案内 (±10%)' },
    { language: 'zh', value: '预估价支付 — 结算说明 (±10%)' },
  ],
};

const RECONCILIATION_BODY = {
  defaultValue: {
    language: 'en',
    value:
      'Your booking was priced using a regional-average estimate (destination outside our pre-priced matrix). '
      + 'If actual distance / driving duration differs from the estimate by more than +/-10%, we will reconcile '
      + '(additional charge or partial refund) within 1 business day after the trip. An itemized statement will '
      + 'be sent before any adjustment.',
  },
  translatedValues: [
    {
      language: 'ko',
      value:
        '본 예약은 권역 평균 추정가로 결제되었습니다 (사전 가격표 미적용 권역). '
        + '실제 거리 / 운행 시간이 추정치 대비 ±10% 이상 차이날 경우, 운행 완료 후 1영업일 이내에 '
        + '추가 청구 또는 부분 환불로 정산해 드립니다. 정산 전 명세서를 먼저 보내드립니다.',
    },
    {
      language: 'ja',
      value:
        'このご予約は地域平均の見積もり料金で決済されています(事前価格表対象外エリア)。 '
        + '実際の距離/運行時間が見積もりより±10%以上異なる場合、運行完了後1営業日以内に '
        + '追加請求または一部返金で精算いたします。精算前に明細をお送りします。',
    },
    {
      language: 'zh',
      value:
        '本订单按区域平均预估价收费(超出预设价格表区域)。 '
        + '若实际距离/驾驶时长与预估相差超过±10%,我们将在行程结束后1个工作日内 '
        + '补差价或部分退款进行结算。结算前会先发送明细单。',
    },
  ],
};

function buildWalletPassPayload(issuerId, classId, booking) {
  const objectId = `${issuerId}.cocotrip-${(booking.transactionId || Date.now()).toString().replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  const baseTextModules = [
    { id: 'guest',   header: 'Guest',        body: booking.customerName  || '-' },
    { id: 'ref',     header: 'Booking Ref',  body: booking.bookingRef    || '-' },
    { id: 'service', header: 'Service',       body: booking.product       || '-' },
    { id: 'pax',     header: 'Party Size',   body: `${booking.paxCount || 1} person(s)` },
    { id: 'driver',  header: 'Driver',        body: 'Taeo' },
    { id: 'contact', header: 'WhatsApp',      body: '+82-10-8714-0611' },
  ];

  // 추정가 정산 안내 모듈 (charter_custom_estimate 표식이 있을 때만 주입)
  if (booking.requiresReconciliation) {
    baseTextModules.push({
      id: 'reconciliation',
      localizedHeader: RECONCILIATION_TITLE,
      localizedBody:   RECONCILIATION_BODY,
    });
  }

  return {
    genericObjects: [{
      id:          objectId,
      classId:     `${issuerId}.${classId}`,
      genericType: 'GENERIC_TYPE_UNSPECIFIED',
      hexBackgroundColor: '#1a1a2e',

      logo: {
        sourceUri: { uri: 'https://cocotripkr.com/favicon.ico' },
        contentDescription: { defaultValue: { language: 'en-US', value: 'CocoTripKR Logo' } },
      },

      cardTitle: { defaultValue: { language: 'en-US', value: 'COCOTRIPKR' } },
      subheader:  { defaultValue: { language: 'en-US', value: 'Korea Private Tour' } },
      header:     { defaultValue: { language: 'en-US', value: booking.tourDate || 'Tour Date TBD' } },

      barcode: {
        type:  'QR_CODE',
        value: booking.transactionId || booking.bookingRef || 'COCOTRIP',
        alternateText: booking.bookingRef || '',
      },

      heroImage: {
        sourceUri: { uri: 'https://cocotripkr.com/og-image.jpg' },
        contentDescription: { defaultValue: { language: 'en-US', value: 'Korea Private Tour' } },
      },

      textModulesData: baseTextModules,

      linksModuleData: {
        uris: [
          {
            uri:         'https://cocotripkr.com',
            description: 'CocoTripKR Website',
            id:          'website',
          },
          {
            uri:         'https://wa.me/821087140611',
            description: 'Contact Driver via WhatsApp',
            id:          'whatsapp',
          },
        ],
      },

      notifications: {
        upcomingNotification: { enableNotification: true },
      },
    }],
  };
}

/**
 * Google Wallet 패스 저장 링크 생성
 * @param {object} booking - 예약 데이터
 * @returns {Promise<string|null>} "https://pay.google.com/gp/v/save/{jwt}" 또는 null
 */
export async function createWalletPass(booking) {
  const issuerId  = process.env.GOOGLE_WALLET_ISSUER_ID;
  const classId   = process.env.GOOGLE_WALLET_CLASS_ID;
  const email     = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const keyBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!issuerId || !classId) {
    console.log('[create-wallet-pass] ISSUER_ID/CLASS_ID 미설정 — 건너뜀 (승인 후 활성화)');
    return null;
  }

  if (!email || !keyBase64) {
    console.log('[create-wallet-pass] 서비스 계정 미설정 — 건너뜀');
    return null;
  }

  try {
    const keyJson    = JSON.parse(Buffer.from(keyBase64, 'base64').toString('utf8'));
    const privateKey = keyJson.private_key;

    const header  = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss:     email,
      aud:     'google',
      typ:     'savetowallet',
      iat:     Math.floor(Date.now() / 1000),
      origins: ['https://cocotripkr.com'],
      payload: buildWalletPassPayload(issuerId, classId, booking),
    };

    const jwt = signRS256JWT(header, payload, privateKey);
    const url = `https://pay.google.com/gp/v/save/${jwt}`;

    console.log('[create-wallet-pass] Wallet 링크 생성 완료');
    return url;
  } catch (err) {
    console.error('[create-wallet-pass] 오류:', err.message);
    return null;
  }
}

export default { createWalletPass };
