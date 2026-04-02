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

function buildWalletPassPayload(issuerId, classId, booking) {
  const objectId = `${issuerId}.cocotrip-${(booking.transactionId || Date.now()).toString().replace(/[^a-zA-Z0-9_-]/g, '-')}`;

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

      textModulesData: [
        { id: 'guest',   header: 'Guest',        body: booking.customerName  || '-' },
        { id: 'ref',     header: 'Booking Ref',  body: booking.bookingRef    || '-' },
        { id: 'service', header: 'Service',       body: booking.product       || '-' },
        { id: 'pax',     header: 'Party Size',   body: `${booking.paxCount || 1} person(s)` },
        { id: 'driver',  header: 'Driver',        body: 'Taeo' },
        { id: 'contact', header: 'WhatsApp',      body: '+82-10-8714-0611' },
      ],

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
