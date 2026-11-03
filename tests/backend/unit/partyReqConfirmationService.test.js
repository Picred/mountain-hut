import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The service reads the booking from the DAO and hands the message to the email service:
// both are replaced, so no database and no real email are involved
vi.mock('../../../backend/models/dao/confirmationDAO.js', () => ({
    getBookingConfirmationData: vi.fn(),
}));

vi.mock('../../../backend/services/emailService.js', () => ({
    sendEmail: vi.fn(),
}));

// ADJUST: file name of the service that contains buildBookingEmail / sendBookingConfirmation
import {
    formatBookingReference,
    buildBookingEmail,
    sendBookingConfirmation,
} from '../../../backend/services/confirmation.js';
import { getBookingConfirmationData } from '../../../backend/models/dao/confirmationDAO.js';
import { sendEmail } from '../../../backend/services/emailService.js';

// Dates are built from local components: the service formats them in the timezone of the machine,
// so the tests give the same result everywhere. 15 January 2030 is a Tuesday.
const booking = {
    reservationId: 42,
    partySize: 3,
    startAt: new Date(2030, 0, 15, 19, 30).toISOString(),
    endAt: new Date(2030, 0, 15, 21, 0).toISOString(),
    hikerName: 'Mario Rossi',
    hikerEmail: 'mario@example.com',
    requirements: [],
};

const withRequirements = (requirements) => ({ ...booking, requirements });

const vegetarian = { peopleCount: 2, description: 'vegetarian', isAllergy: false };
const peanuts = { peopleCount: 1, description: 'peanuts', isAllergy: true };

// What the email must say for the two requirements above
const REQUIREMENTS_TEXT = '2 people: vegetarian; 1 person: peanuts (allergy)';

let errorSpy;

beforeEach(() => {
    vi.resetAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('formatBookingReference', () => {
    it('prefixes the reservation id with #', () => {
        expect(formatBookingReference(42)).toBe('#42');
    });
});

describe('buildBookingEmail', () => {
    it('builds the subject with the booking reference', () => {
        const email = buildBookingEmail(booking);

        expect(email.subject).toBe('Mountain Hut - Booking confirmation #42');
    });

    it('writes the booking details in the plain text', () => {
        const { text } = buildBookingEmail(booking);

        expect(text).toContain('Hello Mario Rossi,');
        expect(text).toContain('Booking reference: #42');
        expect(text).toMatch(/Date: Tuesday,? 15 January 2030/);
        expect(text).toContain('Time slot: 19:30 - 21:00');
        expect(text).toContain('Party size: 3 people');
        expect(text).toContain('Booked by: Mario Rossi');
    });

    it('uses the singular for a party of one person', () => {
        const { text } = buildBookingEmail({ ...booking, partySize: 1 });

        expect(text).toContain('Party size: 1 person');
        expect(text).not.toContain('1 people');
    });

    describe('requirements', () => {
        it('lists every requirement in the text, with the allergies marked', () => {
            const { text } = buildBookingEmail(withRequirements([vegetarian, peanuts]));

            expect(text).toContain(`Requirements: ${REQUIREMENTS_TEXT}`);
        });

        it('lists every requirement in the HTML as well', () => {
            const { html } = buildBookingEmail(withRequirements([vegetarian, peanuts]));

            expect(html).toContain('Requirements');
            expect(html).toContain(REQUIREMENTS_TEXT);
        });

        it('marks as allergy only the requirements flagged as allergies', () => {
            const { text } = buildBookingEmail(withRequirements([vegetarian]));

            expect(text).toContain('Requirements: 2 people: vegetarian');
            expect(text).not.toContain('(allergy)');
        });

        it('says "None" when the party has no requirements', () => {
            const { text, html } = buildBookingEmail(booking);

            expect(text).toContain('Requirements: None');
            expect(html).toContain('None');
        });

        it('uses the singular for a requirement of one person', () => {
            const { text } = buildBookingEmail(withRequirements([peanuts]));

            expect(text).toContain('Requirements: 1 person: peanuts (allergy)');
        });
    });

    describe('HTML escaping', () => {
        it('escapes the data of the user in the HTML', () => {
            const { html } = buildBookingEmail({
                ...booking,
                hikerName: '<b>Mario</b> & "Co"',
                requirements: [{ peopleCount: 1, description: '<script>alert(1)</script>', isAllergy: false }],
            });

            expect(html).not.toContain('<b>Mario</b>');
            expect(html).not.toContain('<script>');
            expect(html).toContain('&lt;b&gt;Mario&lt;/b&gt; &amp; &quot;Co&quot;');
            expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        });

        it('leaves the plain text version unescaped', () => {
            const { text } = buildBookingEmail({ ...booking, hikerName: 'Tom & Jerry' });

            expect(text).toContain('Hello Tom & Jerry,');
        });
    });
});

describe('sendBookingConfirmation', () => {
    it('sends the email to the hiker with the requirements inside', async () => {
        getBookingConfirmationData.mockResolvedValue(withRequirements([vegetarian, peanuts]));

        await sendBookingConfirmation(42);

        expect(getBookingConfirmationData).toHaveBeenCalledWith(42);
        expect(sendEmail).toHaveBeenCalledTimes(1);
        const message = sendEmail.mock.calls[0][0];
        expect(message.to).toBe('mario@example.com');
        expect(message.subject).toBe('Mountain Hut - Booking confirmation #42');
        expect(message.text).toContain(`Requirements: ${REQUIREMENTS_TEXT}`);
        expect(message.html).toContain(REQUIREMENTS_TEXT);
    });

    it('sends the email with "None" when the booking has no requirements', async () => {
        getBookingConfirmationData.mockResolvedValue(booking);

        await sendBookingConfirmation(42);

        expect(sendEmail.mock.calls[0][0].text).toContain('Requirements: None');
    });

    it('sends nothing when the reservation does not exist', async () => {
        getBookingConfirmationData.mockResolvedValue(null);

        await sendBookingConfirmation(999);

        expect(sendEmail).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('does not throw and logs the error when the booking cannot be read', async () => {
        getBookingConfirmationData.mockRejectedValue(new Error('DB down'));

        await expect(sendBookingConfirmation(42)).resolves.toBeUndefined();

        expect(sendEmail).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('reservation 42'), 'DB down');
    });

    it('does not throw and logs the error when the email cannot be sent', async () => {
        getBookingConfirmationData.mockResolvedValue(booking);
        sendEmail.mockRejectedValue(new Error('SMTP error'));

        await expect(sendBookingConfirmation(42)).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('reservation 42'), 'SMTP error');
    });
});