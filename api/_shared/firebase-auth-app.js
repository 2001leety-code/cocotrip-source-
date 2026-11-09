import { getAuth as sdkGetAuth } from 'firebase-admin/auth';
import { getPreviewFirebaseApp } from './preview-firebase-app.js';

export function getAuth() {
  if (process.env.VERCEL_ENV === 'preview') {
    return sdkGetAuth(getPreviewFirebaseApp());
  }
  return sdkGetAuth();
}
