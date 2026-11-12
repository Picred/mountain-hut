import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replace every external dependency so the tests run in memory with no I/O
vi.mock('../../../backend/db/db.js', () => ({
  default: { get: vi.fn(), run: vi.fn(), all: vi.fn() },
  DB_PATH: ':memory:',
}));
vi.mock('../../../backend/utils/dbHelpers.js', () => ({
  dbAll: vi.fn(),
  dbGet: vi.fn(),
  dbRun: vi.fn(),
}));
vi.mock('../../../backend/services/emailService.js', () => ({
  sendEmail: vi.fn(),
}));
vi.mock('../../../backend/models/dao/confirmationDAO.js', () => ({
  getBookingConfirmationData: vi.fn(),
}));

import { dbAll, dbGet } from '../../../backend/utils/dbHelpers.js';
import { sendEmail } from '../../../backend/services/emailService.js';
import { getBookingConfirmationData as getBookingConfirmationDataMock } from '../../../backend/models/dao/confirmationDAO.js';

// Import the actual implementations under test
const { getBookingConfirmationData } = await vi.importActual(
  '../../../backend/models/dao/confirmationDAO.js'
);
const {
  formatBookingReference,
  buildBookingEmail,
  sendBookingConfirmation,
  buildCancellationEmail,
  sendCancellationConfirmation,
} = await vi.importActual('../../../backend/services/confirmation.js');

// ─────────────────────────────────────────────────────────────────────────────
// Shared test fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** A complete booking object as returned by getBookingConfirmationData */
const sampleBooking = {
  reservationId: 42,
  partySize: 3,
  startAt: '2026-11-10T12:00:00.000Z',
  endAt: '2026-11-10T14:00:00.000Z',
  hikerName: 'Anna Winden',
  hikerEmail: 'anna@mountainhut.test',
  requirements: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// confirmationDAO – getBookingConfirmationData
// ─────────────────────────────────────────────────────────────────────────────

describe('confirmationDAO', () => {
  describe('getBookingConfirmationData', () => {
    it('returns null when the reservation does not exist', async () => {
      dbGet.mockResolvedValue(null);

      const result = await getBookingConfirmationData(999);

      expect(result).toBeNull();
      // No need to query requirements if the base row is missing
      expect(dbAll).not.toHaveBeenCalled();
    });

    it('returns the booking data with an empty requirements list when there are no requirements', async () => {
      dbGet.mockResolvedValue({
        reservation_id: 42,
        party_size: 3,
        start_at: '2026-11-10T12:00:00.000Z',
        end_at: '2026-11-10T14:00:00.000Z',
        name: 'Anna Winden',
        email: 'anna@mountainhut.test',
      });
      dbAll.mockResolvedValue([]);

      const result = await getBookingConfirmationData(42);

      expect(result).toEqual({
        reservationId: 42,
        partySize: 3,
        startAt: '2026-11-10T12:00:00.000Z',
        endAt: '2026-11-10T14:00:00.000Z',
        hikerName: 'Anna Winden',
        hikerEmail: 'anna@mountainhut.test',
        requirements: [],
      });
    });


    it('maps requirement rows to camelCase objects, marking allergies correctly', async () => {
      dbGet.mockResolvedValue({
        reservation_id: 7,
        party_size: 2,
        start_at: '2026-11-10T12:00:00.000Z',
        end_at: '2026-11-10T14:00:00.000Z',
        name: 'Marco Polo',
        email: 'marco@mountainhut.test',
      });
      dbAll.mockResolvedValue([
        { people_count: 1, description: 'gluten-free', is_allergy: 1 },
        { people_count: 1, description: 'vegan', is_allergy: 0 },
      ]);

      const result = await getBookingConfirmationData(7);

      expect(result.requirements).toEqual([
        { peopleCount: 1, description: 'gluten-free', isAllergy: true },
        { peopleCount: 1, description: 'vegan', isAllergy: false },
      ]);
    });


    it('queries requirements using the correct reservation id', async () => {
      dbGet.mockResolvedValue({
        reservation_id: 15,
        party_size: 1,
        start_at: '2026-11-10T12:00:00.000Z',
        end_at: '2026-11-10T14:00:00.000Z',
        name: 'Test User',
        email: 'test@mountainhut.test',
      });
      dbAll.mockResolvedValue([]);

      await getBookingConfirmationData(15);

      // dbAll must be called with 15 as the parameter for the WHERE clause
      expect(dbAll).toHaveBeenCalledWith(expect.any(String), [15]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// confirmation service – formatBookingReference
// ─────────────────────────────────────────────────────────────────────────────

describe('confirmation service', () => {
  describe('formatBookingReference', () => {
    it('formats the reservation id as #<id>', () => {
      expect(formatBookingReference(42)).toBe('#42');
      expect(formatBookingReference(1)).toBe('#1');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // confirmation service – buildBookingEmail
  // ─────────────────────────────────────────────────────────────────────────

  describe('buildBookingEmail', () => {
    it('includes the booking reference in the subject', () => {
      const { subject } = buildBookingEmail(sampleBooking);

      expect(subject).toContain('#42');
    });

    it('includes the hiker name in the plain-text body', () => {
      const { text } = buildBookingEmail(sampleBooking);

      expect(text).toContain('Anna Winden');
    });

    it('includes the party size in the plain-text body', () => {
      const { text } = buildBookingEmail(sampleBooking);

      // 3 people → "3 people"
      expect(text).toMatch(/3 people/i);
    });

    it('uses singular "person" for a party of 1', () => {
      const booking = { ...sampleBooking, partySize: 1 };
      const { text } = buildBookingEmail(booking);

      expect(text).toMatch(/1 person/i);
    });

    it('shows "None" in plain-text when requirements list is empty', () => {
      const { text } = buildBookingEmail(sampleBooking);

      expect(text).toContain('None');
    });

    it('lists allergy requirements with the (allergy) label in plain-text', () => {
      const booking = {
        ...sampleBooking,
        requirements: [
          { peopleCount: 1, description: 'gluten-free', isAllergy: true },
        ],
      };
      const { text } = buildBookingEmail(booking);

      expect(text).toContain('gluten-free');
      expect(text).toContain('(allergy)');
    });

    it('lists non-allergy requirements without the (allergy) label in plain-text', () => {
      const booking = {
        ...sampleBooking,
        requirements: [
          { peopleCount: 1, description: 'vegan', isAllergy: false },
        ],
      };
      const { text } = buildBookingEmail(booking);

      expect(text).toContain('vegan');
      expect(text).not.toContain('(allergy)');
    });

    it('escapes HTML special characters in the HTML body', () => {
      const booking = {
        ...sampleBooking,
        hikerName: '<script>alert("xss")</script>',
      };
      const { html } = buildBookingEmail(booking);

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('includes booking reference, date slot info in the HTML body', () => {
      const { html } = buildBookingEmail(sampleBooking);

      expect(html).toContain('#42');
      // Party size appears in the HTML table rows
      expect(html).toMatch(/3 people/i);
    });

    it('returns an object with subject, text, and html fields', () => {
      const email = buildBookingEmail(sampleBooking);

      expect(email).toHaveProperty('subject');
      expect(email).toHaveProperty('text');
      expect(email).toHaveProperty('html');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // confirmation service – sendBookingConfirmation
  // ─────────────────────────────────────────────────────────────────────────

  describe('sendBookingConfirmation', () => {
    it('does nothing and does not throw when the reservation does not exist', async () => {
      getBookingConfirmationDataMock.mockResolvedValue(null);

      await expect(sendBookingConfirmation(999)).resolves.toBeUndefined();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('sends an email to the hiker email address on success', async () => {
      getBookingConfirmationDataMock.mockResolvedValue(sampleBooking);
      sendEmail.mockResolvedValue({});

      await sendBookingConfirmation(42);

      expect(sendEmail).toHaveBeenCalledOnce();
      expect(sendEmail.mock.calls[0][0]).toMatchObject({
        to: 'anna@mountainhut.test',
      });
    });

    it('passes the correct subject and body fields to sendEmail', async () => {
      getBookingConfirmationDataMock.mockResolvedValue(sampleBooking);
      sendEmail.mockResolvedValue({});

      await sendBookingConfirmation(42);

      const arg = sendEmail.mock.calls[0][0];
      expect(arg).toHaveProperty('subject');
      expect(arg).toHaveProperty('text');
      expect(arg).toHaveProperty('html');
      expect(arg.subject).toContain('#42');
    });

    it('does not throw when sendEmail rejects (email errors must not break the booking flow)', async () => {
      getBookingConfirmationDataMock.mockResolvedValue(sampleBooking);
      sendEmail.mockRejectedValue(new Error('SMTP connection timeout'));

      // sendBookingConfirmation swallows email errors intentionally
      await expect(sendBookingConfirmation(42)).resolves.toBeUndefined();
    });

    it('does not throw when getBookingConfirmationData rejects unexpectedly', async () => {
      getBookingConfirmationDataMock.mockRejectedValue(new Error('DB error'));

      await expect(sendBookingConfirmation(42)).resolves.toBeUndefined();
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// confirmation service – buildCancellationEmail
// ─────────────────────────────────────────────────────────────────────────────

describe('confirmation service – cancellation', () => {
  describe('buildCancellationEmail', () => {
    it('includes the booking reference in the subject', () => {
      const { subject } = buildCancellationEmail(sampleBooking);

      expect(subject).toContain('#42');
      expect(subject).toMatch(/cancellation/i);
    });

    it('includes the hiker name and cancellation message in the plain-text body', () => {
      const { text } = buildCancellationEmail(sampleBooking);

      expect(text).toContain('Anna Winden');
      expect(text).toMatch(/successfully cancelled/i);
    });

    it('includes the booking reference, date, time slot and party size', () => {
      const { text } = buildCancellationEmail(sampleBooking);

      expect(text).toContain('Booking reference: #42');
      expect(text).toContain('Date:');
      expect(text).toContain('Time slot:');
      expect(text).toMatch(/3 people/i);
    });

    it('uses singular "person" for a party of 1', () => {
      const booking = { ...sampleBooking, partySize: 1 };
      const { text } = buildCancellationEmail(booking);

      expect(text).toMatch(/1 person/i);
    });

    it('escapes HTML special characters in the HTML body', () => {
      const booking = {
        ...sampleBooking,
        hikerName: '<script>alert("xss")</script>'
      };

      const { html } = buildCancellationEmail(booking);

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('includes the cancellation message and booking details in the HTML body', () => {
      const { html } = buildCancellationEmail(sampleBooking);

      expect(html).toMatch(/successfully cancelled/i);
      expect(html).toContain('#42');
      expect(html).toMatch(/3 people/i);
    });

    it('returns an object with subject, text, and html fields', () => {
      const email = buildCancellationEmail(sampleBooking);

      expect(email).toHaveProperty('subject');
      expect(email).toHaveProperty('text');
      expect(email).toHaveProperty('html');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // confirmation service – sendCancellationConfirmation
  // ─────────────────────────────────────────────────────────────────────────

  describe('sendCancellationConfirmation', () => {
    it('does nothing and does not throw when the reservation does not exist', async () => {
      getBookingConfirmationDataMock.mockResolvedValue(null);

      await expect(sendCancellationConfirmation(999)).resolves.toBeUndefined();

      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('sends an email to the hiker email address on success', async () => {
      getBookingConfirmationDataMock.mockResolvedValue(sampleBooking);
      sendEmail.mockResolvedValue({});

      await sendCancellationConfirmation(42);

      expect(getBookingConfirmationDataMock).toHaveBeenCalledWith(42);
      expect(sendEmail).toHaveBeenCalledOnce();
      expect(sendEmail.mock.calls[0][0]).toMatchObject({
        to: 'anna@mountainhut.test'
      });
    });

    it('passes the correct cancellation subject and body fields to sendEmail', async () => {
      getBookingConfirmationDataMock.mockResolvedValue(sampleBooking);
      sendEmail.mockResolvedValue({});

      await sendCancellationConfirmation(42);

      const arg = sendEmail.mock.calls[0][0];

      expect(arg).toHaveProperty('subject');
      expect(arg).toHaveProperty('text');
      expect(arg).toHaveProperty('html');
      expect(arg.subject).toContain('#42');
      expect(arg.subject).toMatch(/cancellation/i);
      expect(arg.text).toMatch(/successfully cancelled/i);
    });

    it('does not throw when sendEmail rejects (email errors must not break cancellation)', async () => {
      getBookingConfirmationDataMock.mockResolvedValue(sampleBooking);
      sendEmail.mockRejectedValue(new Error('SMTP connection timeout'));

      // Cancellation must remain successful even when the email cannot be sent
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      try {
        await expect(sendCancellationConfirmation(42)).resolves.toBeUndefined();

        expect(consoleSpy).toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
      }
    });

    it('does not throw when getBookingConfirmationData rejects unexpectedly', async () => {
      getBookingConfirmationDataMock.mockRejectedValue(new Error('DB error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      try {
        await expect(sendCancellationConfirmation(42)).resolves.toBeUndefined();

        expect(sendEmail).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });
});

