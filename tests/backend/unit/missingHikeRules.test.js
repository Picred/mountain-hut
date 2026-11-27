import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    FIRST_ALERT_AFTER_HOURS,
    MAX_ALERTS,
    getTimeScale,
    alertUnitMs,
    dueAlertNumber,
    checkIntervalMs,
} from '../../../backend/utils/missingHikeRules.js';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('missingHikeRules', () => {

    describe('constants', () => {
        it('defines the first alert after 2 hours', () => {
            expect(FIRST_ALERT_AFTER_HOURS).toBe(2);
        });

        it('defines a maximum of 5 alerts', () => {
            expect(MAX_ALERTS).toBe(5);
        });
    });

    describe('getTimeScale', () => {
        it('returns 1 when the environment variable is not defined', () => {
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', undefined);

            expect(getTimeScale()).toBe(1);
        });

        it('returns 1 when the environment variable is empty', () => {
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '');

            expect(getTimeScale()).toBe(1);
        });

        it('returns 1 when the environment variable contains only spaces', () => {
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '   ');

            expect(getTimeScale()).toBe(1);
        });

        it('returns the configured positive time scale', () => {
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '60');

            expect(getTimeScale()).toBe(60);
        });

        it.each(['abc', '0', '-1', '-10'])(
            'throws an error when the time scale is invalid: %s',
            (value) => {
                vi.stubEnv('MISSING_HIKE_TIME_SCALE', value);

                expect(() => getTimeScale()).toThrow(
                    `MISSING_HIKE_TIME_SCALE must be a positive number, got "${value}"`
                );
            }
        );
    });

    describe('alertUnitMs', () => {
        it('returns one hour in milliseconds with the default time scale', () => {
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '1');

            expect(alertUnitMs()).toBe(HOUR);
        });

        it('returns one minute when the time scale is 60', () => {
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '60');

            expect(alertUnitMs()).toBe(MINUTE);
        });

        it('returns the correct duration for a fractional time scale', () => {
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '2');

            expect(alertUnitMs()).toBe(30 * MINUTE);
        });
    });

    describe('dueAlertNumber', () => {
        it('returns 0 before the expected arrival time', () => {
            expect(dueAlertNumber(-HOUR)).toBe(0);
        });

        it('returns 0 when less than 2 hours have passed', () => {
            expect(dueAlertNumber(HOUR + 59 * MINUTE)).toBe(0);
        });

        it('does not send the first alert before exactly 2 hours', () => {
            expect(dueAlertNumber(2 * HOUR - 1)).toBe(0);
        });

        it('returns the first alert after exactly 2 hours', () => {
            expect(dueAlertNumber(2 * HOUR)).toBe(1);
        });

        it('returns the second alert after 3 hours', () => {
            expect(dueAlertNumber(3 * HOUR)).toBe(2);
        });

        it('returns the third alert after 4 hours', () => {
            expect(dueAlertNumber(4 * HOUR)).toBe(3);
        });

        it('returns the fourth alert after 5 hours', () => {
            expect(dueAlertNumber(5 * HOUR)).toBe(4);
        });

        it('returns the fifth and final alert after 6 hours', () => {
            expect(dueAlertNumber(6 * HOUR)).toBe(5);
        });

        it('never exceeds the maximum number of alerts', () => {
            expect(dueAlertNumber(7 * HOUR)).toBe(MAX_ALERTS);
            expect(dueAlertNumber(12 * HOUR)).toBe(MAX_ALERTS);
            expect(dueAlertNumber(24 * HOUR)).toBe(MAX_ALERTS);
        });

        it('uses the configured time scale when calculating alert deadlines', () => {
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '60');

            expect(dueAlertNumber(119 * MINUTE)).toBe(5);
        });
    });

    describe('checkIntervalMs', () => {
        it('checks every minute with the default time scale', () => {
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '1');

            expect(checkIntervalMs()).toBe(MINUTE);
        });

        it('checks every second when the time scale is 60', () => {
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '60');

            expect(checkIntervalMs()).toBe(1000);
        });

        it('never returns an interval shorter than one second', () => {
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '120');

            expect(checkIntervalMs()).toBe(1000);
        });

        it('never returns an interval longer than one minute', () => {
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '0.5');

            expect(checkIntervalMs()).toBe(MINUTE);
        });
    });
});
