import admin from 'firebase-admin';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Initialize Firebase Admin
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

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

const originalHandler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  try {
    const { code, productType, originalPrice } = JSON.parse(event.body || '{}');

    if (!code || !originalPrice) {
      return respond(400, { error: 'Missing code or originalPrice' });
    }

    // Only EARLY50 code is valid
    if (code.toUpperCase() !== 'EARLY50') {
      return respond(400, { valid: false, error: 'invalid_code' });
    }

    // Check usage count in Firestore
    const counterRef = db.collection('earlybird').doc('counter');
    const counterDoc = await counterRef.get();
    const used = counterDoc.exists ? (counterDoc.data().used || 0) : 0;

    if (used >= 50) {
      return respond(400, { valid: false, error: 'promo_expired' });
    }

    // Calculate discount
    const discount = 0.20; // 20%
    const savedAmount = Math.round(originalPrice * discount);
    const discountedPrice = originalPrice - savedAmount;

    // Increment usage counter
    if (counterDoc.exists) {
      await counterRef.update({ used: admin.firestore.FieldValue.increment(1) });
    } else {
      await counterRef.set({ used: 1, maxUses: 50 });
    }

    return respond(200, {
      valid: true,
      discountedPrice,
      savedAmount,
      originalPrice,
      discountPercent: 20,
      remaining: Math.max(0, 49 - used), // after this use
    });
  } catch (err) {
    console.error('[applyPromoCode] Error:', err);
    return respond(500, { error: err.message });
  }
};

// --- Vercel Native Wrapper ---
export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    return res.status(200).end();
  }

  const event = {
    httpMethod: req.method,
    path: req.url.split('?')[0],
    body: typeof req.body === 'object' ? JSON.stringify(req.body) : (req.body || ''),
    queryStringParameters: req.query || {},
    headers: req.headers || {}
  };
  
  try {
    const result = await originalHandler(event, {});
    
    if (result && result.headers) {
      for (const [key, val] of Object.entries(result.headers)) {
        res.setHeader(key, val);
      }
    }
    if (result && result.statusCode) {
      let finalBody = result.body;
      if (typeof finalBody === 'string') {
        try { finalBody = JSON.parse(finalBody); } catch(e) {}
      }
      return res.status(result.statusCode).json(finalBody);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
  