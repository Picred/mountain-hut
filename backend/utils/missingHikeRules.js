import { isPositiveNumber } from './validator.js';

/**
 * Rules of the alerts for a hiker who has not recorded the end of the hike.
 *
 * The hiker is considered missing FIRST_ALERT_AFTER_HOURS hours after the expected
 * return time: the first alert is sent then, and one more after each following hour,
 * until MAX_ALERTS alerts have been sent.
 */
export const FIRST_ALERT_AFTER_HOURS = 2;
export const MAX_ALERTS = 5;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Time scale (environment variable MISSING_HIKE_TIME_SCALE), to try the alerts
 * without waiting for hours: with a scale of 60 every "hour" of the rules lasts
 * one minute. When it is not set the scale is 1, the real time.
 *
 * It is read every time, not once, because the .env file is loaded after this module.
 */
export const getTimeScale = () => {
    const raw = process.env.MISSING_HIKE_TIME_SCALE;

    if (raw === undefined || raw.trim() === '') {
        return 1;
    }

    const scale = Number(raw);

    if (!isPositiveNumber(scale)) {
        throw new Error(`MISSING_HIKE_TIME_SCALE must be a positive number, got "${raw}"`);
    }

    return scale;
};

// Duration in milliseconds of one "hour" of the rules
export const alertUnitMs = () => HOUR_MS / getTimeScale();

/**
 * Number of the alert due when the expected return time passed elapsedMs ago:
 * 0 before the hiker is missing, then 1, 2, ... and MAX_ALERTS from then on.
 */
export const dueAlertNumber = (elapsedMs) => {
    const hours = Math.floor(elapsedMs / alertUnitMs());

    if (hours < FIRST_ALERT_AFTER_HOURS) {
        return 0;
    }

    return Math.min(MAX_ALERTS, hours - FIRST_ALERT_AFTER_HOURS + 1);
};

// How often to look for missing hikers: a minute, less if the time is scaled so that no alert is late
export const checkIntervalMs = () =>
    Math.min(MINUTE_MS, Math.max(1000, MINUTE_MS / getTimeScale()));
