import { runTransaction, doc, collection, serverTimestamp } from 'firebase/firestore';

/**
 * Reserve seats for a tour using a Firestore transaction.
 *
 * tours/{tourId}:
 * - totalSeats: number
 * - currentBookings: number (reserved seats)
 *
 * Reservation:
 * - remaining = totalSeats - currentBookings
 * - if remaining < partySize => throw
 * - update currentBookings += partySize atomically
 */
export async function reserveTourSeats({
  db,
  tourId,
  partySize,
  userId,
  tourDate,
  customer,
}) {
  if (!db) throw new Error('reserveTourSeats: db is required');
  if (!tourId) throw new Error('reserveTourSeats: tourId is required');
  if (!userId) throw new Error('reserveTourSeats: userId is required');
  if (!Number.isFinite(partySize) || partySize <= 0) {
    throw new Error('reserveTourSeats: partySize must be a positive number');
  }

  const tourRef = doc(db, 'tours', tourId);
  const bookingRef = doc(collection(db, 'tours', tourId, 'bookings'));

  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(tourRef);
    if (!snap.exists()) {
      throw new Error('Tour not found');
    }

    const data = snap.data() ?? {};
    const totalSeats = Number(data.totalSeats ?? 0);
    const currentBookings = Number(data.currentBookings ?? 0);

    if (!Number.isFinite(totalSeats) || totalSeats < 0) {
      throw new Error('Tour totalSeats is invalid');
    }
    if (!Number.isFinite(currentBookings) || currentBookings < 0) {
      throw new Error('Tour currentBookings is invalid');
    }

    const remainingSeats = totalSeats - currentBookings;
    if (remainingSeats < partySize) {
      throw new Error(
        `Not enough seats. Remaining: ${remainingSeats}, requested: ${partySize}`
      );
    }

    // Create booking record + increment reserved seats atomically.
    tx.update(tourRef, {
      currentBookings: currentBookings + partySize,
      updatedAt: serverTimestamp(),
    });

    tx.set(bookingRef, {
      id: bookingRef.id,
      userId,
      partySize,
      tourDate: tourDate ?? null,
      customer: customer ?? {},
      status: 'confirmed',
      createdAt: serverTimestamp(),
    });

    return {
      bookingId: bookingRef.id,
      remainingSeatsAfter: remainingSeats - partySize,
    };
  });
}

