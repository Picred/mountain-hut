import { sendEmail } from './emailService.js';
import { escapeHtml } from './confirmation.js';

// email subject and body with the new temporary password
export const buildPasswordRecoveryEmail = (name, password) => {
    const text = [
        `Hello ${name},`,
        '',
        'we received a request to recover the password of your Mountain Hut account.',
        '',
        `Your new temporary password is: ${password}`,
        '',
        'You will be asked to choose a new password at your next login.',
        'If you did not make this request, log in with this password and change it.'
    ].join('\n');

    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">
<p>Hello ${escapeHtml(name)},</p>
<p>we received a request to recover the password of your Mountain Hut account.</p>
<p>Your new temporary password is: <strong style="font-family:monospace;font-size:17px">${escapeHtml(password)}</strong></p>
<p>You will be asked to choose a new password at your next login.<br>
If you did not make this request, log in with this password and change it.</p>
</div>`;

    return {
        subject: 'Mountain Hut - Password recovery',
        text,
        html
    };
};

/**
 * Sends the new temporary password to the hiker.
 *
 * Unlike the booking confirmation, it tells whether the email was sent:
 * the new password must be saved only if the hiker received it,
 * otherwise they would be left with a password they do not know.
 * It never throws, a problem with the email is only logged
 */
export const sendPasswordRecovery = async (to, name, password) => {
    try {
        await sendEmail({ to, ...buildPasswordRecoveryEmail(name, password) });
        return true;
    } catch (err) {
        console.error(`[mail] password recovery email to ${to} not sent:`, err.message);
        return false;
    }
};