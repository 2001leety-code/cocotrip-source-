// Backward-compat shim — initAdminDb canonical location is now
// api/_shared/firebase-admin.js (used by chat/quick/og-image and any
// future routes). ai-planner-full.js still imports from here; kept as
// a re-export so we don't churn the locked file.
export { initAdminDb } from '../_shared/firebase-admin.js';
