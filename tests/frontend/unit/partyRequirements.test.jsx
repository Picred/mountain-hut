import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ADJUST: the file that exports createReservation (it is not named in the code you sent me)
import { createReservation } from '../../../frontend/src/api/reservation_api.js';

// ---------------------------------------------------------------------------
// Fake network: the only thing replaced is fetch, createReservation is the real one
// ---------------------------------------------------------------------------
const mockFetch = (status = 200, body) => {
  const raw = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
  const fetchMock = vi.fn(async () => new Response(raw, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

// What the function sent: URL parsed (the base URL does not matter), options and JSON body
const sentUrl = (fetchMock) => new URL(fetchMock.mock.calls[0][0]);
const sentOptions = (fetchMock) => fetchMock.mock.calls[0][1];
const sentBody = (fetchMock) => JSON.parse(sentOptions(fetchMock).body);

const vegetarian = { peopleCount: 2, description: 'vegetarian', isAllergy: false };
const peanuts = { peopleCount: 1, description: 'peanuts', isAllergy: true };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals(); // removes the fake fetch
});

describe('createReservation: request', () => {
  it('calls POST /api/reservations with the session cookie and a JSON body', async () => {
    const fetchMock = mockFetch(201, { reservationId: 42 });

    await createReservation(4, 3, [vegetarian]);

    expect(sentUrl(fetchMock).pathname).toBe('/api/reservations');
    expect(sentOptions(fetchMock)).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('sends the party requirements together with slot and party size', async () => {
    const fetchMock = mockFetch(201, { reservationId: 42 });

    await createReservation(4, 3, [vegetarian, peanuts]);

    expect(sentBody(fetchMock)).toEqual({
      slotId: 4,
      partySize: 3,
      requirements: [
        { peopleCount: 2, description: 'vegetarian', isAllergy: false },
        { peopleCount: 1, description: 'peanuts', isAllergy: true },
      ],
    });
  });

  it('sends an empty list when no requirements are given', async () => {
    const fetchMock = mockFetch(201, { reservationId: 42 });

    await createReservation(4, 2);

    expect(sentBody(fetchMock).requirements).toEqual([]);
  });

  it('converts slotId and partySize to numbers (they can come from form fields)', async () => {
    const fetchMock = mockFetch(201, { reservationId: 42 });

    await createReservation('4', '3', [vegetarian]);

    const body = sentBody(fetchMock);
    expect(body.slotId).toBe(4);
    expect(body.partySize).toBe(3);
  });

  it('passes the requirements through unchanged: the caller must give them already typed', async () => {
    const fetchMock = mockFetch(201, { reservationId: 42 });
    const asTyped = [{ peopleCount: '2', description: 'vegetarian', isAllergy: 'false' }];

    await createReservation(4, 3, asTyped);

    // no conversion here: a "2" stays a string and the backend would reject it with 400
    expect(sentBody(fetchMock).requirements).toEqual(asTyped);
  });
});

describe('createReservation: success', () => {
  it('returns the reservation sent by the server, requirements included', async () => {
    const reservation = { reservationId: 42, slotId: 4, partySize: 3, requirements: [vegetarian, peanuts] };
    mockFetch(201, reservation);

    await expect(createReservation(4, 3, [vegetarian, peanuts])).resolves.toEqual(reservation);
  });
});

describe('createReservation: errors', () => {
  it.each([
    ['401 without a session', 401, {}, 'You must be logged in to book a table.'],
    ['409 ALREADY_BOOKED', 409, { error: 'ALREADY_BOOKED' }, 'You already have a reservation for this time slot.'],
    ['409 BOOKING_TOO_LATE', 409, { error: 'BOOKING_TOO_LATE' }, 'Booking is no longer available (less than 2 hours remaining).'],
    ['409 NO_AVAILABILITY', 409, { error: 'NO_AVAILABILITY' }, 'Not enough seats available for this party size.'],
    ['409 with another code and a message', 409, { error: 'OTHER', message: 'Custom conflict' }, 'Custom conflict'],
    ['409 with another code and no message', 409, { error: 'OTHER' }, 'Slot no longer available.'],
    ['404 slot not found', 404, { error: 'SLOT_NOT_FOUND' }, 'Selected time slot was not found.'],
    ['400 with a message', 400, { message: 'Invalid requirements' }, 'Invalid requirements'],
    ['400 with only an error code', 400, { error: 'INVALID_INPUT' }, 'Failed to create reservation.'],
    ['500 with an empty body', 500, {}, 'Failed to create reservation.'],
  ])('%s -> readable message', async (_label, status, body, message) => {
    mockFetch(status, body);

    await expect(createReservation(4, 3, [vegetarian])).rejects.toThrow(message);
  });

  it('uses the default message when the body of the answer is not JSON', async () => {
    mockFetch(500, '<html>Internal Server Error</html>');

    await expect(createReservation(4, 3, [vegetarian])).rejects.toThrow('Failed to create reservation.');
  });
});