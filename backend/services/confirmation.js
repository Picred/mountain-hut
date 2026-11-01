import { getBookingConfirmationData } from '../models/dao/confirmationDAO.js';
import { sendEmail } from './emailService.js';

export const formatBookingReference = (reservationId) => `#${reservationId}`

// dates and times use the timezone of the server, not a fixed timezone
const formatDate = (isoDate) =>
    new Date(isoDate).toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

const formatTime = (isoDate) =>
    new Date(isoDate).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false
    });

const plural = (n, singular, pluralForm) => (n === 1 ? singular : pluralForm);

const formatRequirements = (requirements) => {
    if (requirements.length === 0) return 'None';

    return requirements
        .map(req => {
            const people = `${req.peopleCount} ${plural(req.peopleCount, 'person', 'people')}`;
            return `${people}: ${req.description}${req.isAllergy ? ' (allergy)' : ''}`;
        })
        .join('; ');
};

const escapeHtml = (value) =>
    String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

// email subject and body
export const buildBookingEmail = (booking) => {
    const details = [
        ['Booking reference', formatBookingReference(booking.reservationId)],
        ['Date', formatDate(booking.startAt)],
        ['Time slot', `${formatTime(booking.startAt)} - ${formatTime(booking.endAt)}`],
        ['Party size', `${booking.partySize} ${plural(booking.partySize, 'person', 'people')}`],
        ['Requirements', formatRequirements(booking.requirements)],
        ['Booked by', booking.hikerName]
    ];

    const text = [
        `Hello ${booking.hikerName},`,
        '',
        'your reservation at the Mountain Hut is confirmed. Here are the details of your booking:',
        '',
        ...details.map(([label, value]) => `${label}: ${value}`),
        '',
        'Please keep the booking reference.',
        'See you soon!'
    ].join('\n');

    const rows = details
        .map(([label, value]) =>
            `<tr><td style="padding:4px 16px 4px 0;color:#555">${escapeHtml(label)}</td>` +
            `<td style="padding:4px 0"><strong>${escapeHtml(value)}</strong></td></tr>`)
        .join('\n');

    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">
<p>Hello ${escapeHtml(booking.hikerName)},</p>
<p>your reservation at the Mountain Hut is confirmed. Here are the details of your booking:</p>
<table style="border-collapse:collapse">
${rows}
</table>
<p>Please keep the booking reference.<br>See you soon!</p>
</div>`;

    return {
        subject: `Mountain Hut - Booking confirmation ${formatBookingReference(booking.reservationId)}`,
        text,
        html
    };
};

/**
 * Sends the confirmation email of a reservation to the hiker who made it.
 *
 * It never throws: the reservation is already saved, so a problem with the
 * email is only logged and must not make the booking request fail
 */
export const sendBookingConfirmation = async (reservationId) => {
    try {
        const booking = await getBookingConfirmationData(reservationId);

        if (!booking) {
            // nobody to notify
            return;
        }

        await sendEmail({ to: booking.hikerEmail, ...buildBookingEmail(booking) });
    } catch (err) {
        console.error(`[mail] confirmation email of reservation ${reservationId} not sent:`, err.message);
    }
};