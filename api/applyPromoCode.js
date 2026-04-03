/**
 * Vercel API Route: Apply Promo Code (EARLY50)
 * POST /api/applyPromoCode
 */
import admin from 'firebase-admin';

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Initialize Firebase Admin (lazy, once)
if (!admin.apps.length) {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { code, originalPrice } = body;

    if (!code || !originalPrice) {
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing code or originalPrice' }));
    }

    if (code.toUpperCase() !== 'EARLY50') {
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ valid: false, error: 'invalid_code' }));
    }

    // Check usage count
    const counterRef = db.collection('earlybird').doc('counter');
    const counterDoc = await counterRef.get();
    const used = counterDoc.exists ? (counterDoc.data().used || 0) : 0;

    if (used >= 50) {
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ valid: false, error: 'promo_expired' }));
    }

    const discount = 0.20;
    const savedAmount = Math.round(originalPrice * discount);
    const discountedPrice = originalPrice - savedAmount;

    if (counterDoc.exists) {
      await counterRef.update({ used: admin.firestore.FieldValue.increment(1) });
    } else {
      await counterRef.set({ used: 1, maxUses: 50 });
    }

    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      valid: true,
      discountedPrice,
      savedAmount,
      originalPrice,
      discountPercent: 20,
      remaining: Math.max(0, 49 - used),
    }));
  } catch (err) {
    console.error('[applyPromoCode] Error:', err);
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}