import {
    getOverdueScheduledHikes,
    getMissingHikes,
    createHikeAlert,
    getHikesWithEmailToSend,
    getWardenEmails,
    markAlertEmailSent
} from "../models/dao/hikeDAO.js";
import { checkIntervalMs, dueAlertNumber, MAX_ALERTS } from "../utils/missingHikeRules.js";
import { sendEmail } from "./emailService.js";

let timeoutId = null;
let isRunning = false;

export const startMissingHikeJob = () => {
    if (isRunning) return;

    const intervalMs = checkIntervalMs();
    isRunning = true;

    const run = async () => {
        if (!isRunning) return;

        const now = new Date();
        await checkMissingHikes(now);

        if (isRunning) {
            timeoutId = setTimeout(run, intervalMs);
        }
    };

    timeoutId = setTimeout(run, intervalMs);
};

export const stopMissingHikeJob = () => {
    isRunning = false;
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
};


/**
 * Main check function.
 * @param {Date} now
 * @param {Object} [deps] - Dependency overrides for testing
 */
export const checkMissingHikes = async (now, deps = {}) => {
    const {
        getOverdueScheduledHikes: getOverdue = getOverdueScheduledHikes,
        getMissingHikes: getMissing = getMissingHikes,
        createHikeAlert: createAlert = createHikeAlert,
        getHikesWithEmailToSend: getEmailHikes = getHikesWithEmailToSend,
        getWardenEmails: getWardens = getWardenEmails,
        sendEmail: sendEmailFn = sendEmail,
        markAlertEmailSent: markSent = markAlertEmailSent
    } = deps;

    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    const overdueHikes = await getOverdue(nowIso);
    const existingAlerts = await getMissing();

    const dueAlerts = computeDueAlerts(overdueHikes, existingAlerts, nowMs);
    await createMissingAlerts(dueAlerts, createAlert, nowIso);

    const hikesWithEmailToSend = await getEmailHikes();
    const wardenEmails = await getWardens();
    await sendPendingAlertEmails(hikesWithEmailToSend, wardenEmails, sendEmailFn, markSent, nowIso);
};


/**
 * Computes which alert needs to be created for each overdue hike.
 * Only returns the currently due alert (not past missed ones).
 * @param {Array<{hikeId: number, expectedArrival: string}>} overdueHikes
 * @param {Array<{hikeId: number, alertNumber: number}>} existingAlerts
 * @param {number} nowMs
 * @returns {Array<{hikeId: number, alertNumber: number}>}
 */
export const computeDueAlerts = (overdueHikes, existingAlerts, nowMs) => {
    const lastAlertByHikeId = new Map(existingAlerts.map(h => [h.hikeId, h.alertNumber]));

    return overdueHikes
        .map(hike => {
            const expectedArrivalMs = Date.parse(hike.expectedArrival);
            const elapsedMs = nowMs - expectedArrivalMs;
            const dueAlert = dueAlertNumber(elapsedMs);
            const lastAlert = lastAlertByHikeId.get(hike.hikeId) ?? 0;

            // Only create the current due alert, not past missed ones
            if (dueAlert > lastAlert) {
                return { hikeId: hike.hikeId, alertNumber: dueAlert };
            }
            return null;
        })
        .filter(Boolean);
};

/**
 * Builds email content for a missing hiker alert.
 * @param {{hiker: {name: string, email: string, phone: string|null, emergencyContact: string|null}, destination: string, route: string, partySize: number, expectedArrival: string}} hike
 * @param {number} alertNum
 * @returns {{subject: string, text: string}}
 */
export const buildAlertEmail = (hike, alertNum) => {
    const expectedArrival = new Date(hike.expectedArrival).toLocaleString();
    const subject = `[Mountain Hut] Missing Hiker Alert #${alertNum} - ${hike.hiker.name}`;
    const text = `Hiker ${hike.hiker.name} (${hike.hiker.email}) has not returned from hike to ${hike.destination}.\n` +
        `Expected return: ${expectedArrival}\n` +
        `Alert number: ${alertNum} of ${MAX_ALERTS}\n` +
        `Route: ${hike.route}\n` +
        `Party size: ${hike.partySize}\n` +
        `Hiker phone: ${hike.hiker.phone ?? 'N/A'}\n` +
        `Emergency contact: ${hike.hiker.emergencyContact ?? 'N/A'}\n`;
    return { subject, text };
};


/**
 * Creates hike alerts in the database.
 * @param {Array<{hikeId: number, alertNumber: number}>} dueAlerts
 * @param {Function} createHikeAlertFn
 * @param {string} nowIso
 */
export const createMissingAlerts = async (dueAlerts, createHikeAlertFn, nowIso) => {
    for (const { hikeId, alertNumber } of dueAlerts) {
        const created = await createHikeAlertFn(hikeId, alertNumber, nowIso);
        if (created) {
            console.log(`Created alert #${alertNumber} for hike ${hikeId}`);
        }
    }
};

/**
 * Sends alert emails to wardens for hikes with unsent emails.
 * @param {Array} hikesWithEmailToSend
 * @param {string[]} wardenEmails
 * @param {Function} sendEmailFn
 * @param {Function} markAlertEmailSentFn
 * @param {string} nowIso
 */
export const sendPendingAlertEmails = async (hikesWithEmailToSend, wardenEmails, sendEmailFn, markAlertEmailSentFn, nowIso) => {
    if (wardenEmails.length === 0) {
        console.log('No wardens configured, skipping email sending');
        return;
    }

    for (const hike of hikesWithEmailToSend) {
        const alertNum = hike.alertNumber;
        const { subject, text } = buildAlertEmail(hike, alertNum);

        for (const email of wardenEmails) {
            try {
                await sendEmailFn({ to: email, subject, text });
            } catch (err) {
                console.error(`Failed to send email to ${email} for alert #${alertNum} of hike ${hike.hikeId}:`, err);
            }
        }

        try {
            await markAlertEmailSentFn(hike.hikeId, alertNum, nowIso);
            console.log(`Alert #${alertNum} for hike ${hike.hikeId} marked as sent`);
        } catch (err) {
            console.error(`Failed to mark alert #${alertNum} of hike ${hike.hikeId} as sent:`, err);
        }
    }
};


