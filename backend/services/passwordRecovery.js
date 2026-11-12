import { sendEmail } from './emailService.js';
import { escapeHtml } from './confirmation.js';

// email subject and body with the link to choose a new password
export const buildPasswordRecoveryEmail = (name, link) => {
    const text = [
        `Hello ${name},`,
        '',
        'we received a request to recover the password of your Mountain Hut account.',
        '',
        'Open this link to choose a new password:',
        link,
        '',
        'The link is valid for 24 hours and can be used only once.',
        'If you did not make this request, ignore this email: your password does not change.'
    ].join('\n');

    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">
<p>Hello ${escapeHtml(name)},</p>
<p>we received a request to recover the password of your Mountain Hut account.</p>
<p><a href="${escapeHtml(link)}">Choose a new password</a></p>
<p>The link is valid for 24 hours and can be used only once.<br>
If you did not make this request, ignore this email: your password does not change.</p>
</div>`;

    return {
        subject: 'Mountain Hut - Password recovery',
        text,
        html
    };
};

/**
 * Sends the password reset link to the hiker.
 * It never throws, a problem with the email is only logged
 */
export const sendPasswordRecovery = async (to, name, link) => {
    try {
        await sendEmail({ to, ...buildPasswordRecoveryEmail(name, link) });
        return true;
    } catch (err) {
        console.error(`[mail] password recovery email to ${to} not sent:`, err.message);
        return false;
    }
};