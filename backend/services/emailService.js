import nodemailer from 'nodemailer';


// variables already set in the environment (.env) are not overwritten
try {
    process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
}

let transporter;

/**
 * creates the transporter the first time it is needed
 *
 * with MAIL_USER and MAIL_PASS set it connects to the SMTP server (by default Gmail)
 * without them no email is sent, the message is printed in the console
 */
const getTransporter = () => {
    if (transporter) return transporter;

    const { MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS } = process.env;

    if (MAIL_USER && MAIL_PASS) {
        const port = Number(MAIL_PORT) || 465;
        transporter = nodemailer.createTransport({
            host: MAIL_HOST || 'smtp.gmail.com',
            port,
            secure: port === 465, // 465: TLS from the start, 587: STARTTLS
            auth: { user: MAIL_USER, pass: MAIL_PASS },
            // do not leave a booking request waiting if the server is unreachable
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 20000
        });
    } else {
        transporter = nodemailer.createTransport({
            streamTransport: true,
            buffer: true,
            newline: 'unix'
        });
    }

    return transporter;
};

/**
 * sends an email, rejects if the SMTP server refuses it or is unreachable
 */
export const sendEmail = async ({ to, subject, text, html }) => {
    const from = process.env.MAIL_FROM ||
        `Mountain Hut <${process.env.MAIL_USER || 'no-reply@mountainhut.local'}>`;

    const info = await getTransporter().sendMail({ from, to, subject, text, html });

    if (info.message) {
        // console mode
        console.log(`[mail] SMTP is not configured, email NOT sent.\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
    } else {
        console.log(`[mail] email sent to ${to} (${info.messageId})`);
    }

    return info;
};