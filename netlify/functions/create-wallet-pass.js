/**
 * CocoTripKR ??Google Wallet ?îÏ????®Ïä§ ?ùÏÑ±
 *
 * Generic Pass (JWT) Î∞©Ïãù ?¨Ïö©
 * ?úÎπÑ??Í≥ÑÏ†ï private keyÎ°?RS256 ?úÎ™Ö ??pay.google.com/gp/v/save/{jwt} URL Î∞òÌôò
 *
 * CONTEXT: booking-processor.js?êÏÑú ?∏Ï∂ú?òÎäî ?†Ìã∏Î¶¨Ìã∞ (HTTP handler ?ÜÏùå)
 * ENV: GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_CLASS_ID,
 *      GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY
 *
 * NOTE: Google Wallet API ?¨Ï†Ñ ?πÏù∏ ?ÑÏöî
 *       GOOGLE_WALLET_ISSUER_ID ÎØ∏ÏÑ§????null Î∞òÌôò (graceful skip)
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
 * Google Wallet ?®Ïä§ ?Ä??ÎßÅÌÅ¨ ?ùÏÑ±
 * @param {object} booking - ?àÏïΩ ?∞Ïù¥?? * @returns {Promise<string|null>} "https://pay.google.com/gp/v/save/{jwt}" ?êÎäî null
 */
export async function createWalletPass(booking) {
  const issuerId  = process.env.GOOGLE_WALLET_ISSUER_ID;
  const classId   = process.env.GOOGLE_WALLET_CLASS_ID;
  const email     = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const keyBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!issuerId || !classId) {
    console.log('[create-wallet-pass] ISSUER_ID/CLASS_ID ÎØ∏ÏÑ§????Í±¥ÎÑà?Ä (?πÏù∏ ???úÏÑ±??');
    return null;
  }

  if (!email || !keyBase64) {
    console.log('[create-wallet-pass] ?úÎπÑ??Í≥ÑÏ†ï ÎØ∏ÏÑ§????Í±¥ÎÑà?Ä');
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

    console.log('[create-wallet-pass] Wallet ÎßÅÌÅ¨ ?ùÏÑ± ?ÑÎ£å');
    return url;
  } catch (err) {
    console.error('[create-wallet-pass] ?§Î•ò:', err.message);
    return null;
  }
}

export default { createWalletPass };
