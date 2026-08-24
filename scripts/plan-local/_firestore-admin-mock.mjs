/** Firestore boundary used only by the offline planner harness. */

import { makeMockAdminDb } from './_mocks.mjs';

let db = null;

export function initAdminDb() {
  if (!db) db = makeMockAdminDb();
  return db;
}

export default initAdminDb;
