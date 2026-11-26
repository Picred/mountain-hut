import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    startMissingHikeJob,
    stopMissingHikeJob,
    checkMissingHikes,
    computeDueAlerts,
    buildAlertEmail,
    createMissingAlerts,
    sendPendingAlertEmails,
} from '../../../backend/services/missingHikeJob.js';

import { MAX_ALERTS } from '../../../backend/utils/missingHikeRules.js';

const HOUR = 60 * 60 * 1000;

const NOW = new Date('2028-06-10T12:00:00.000Z');
const NOW_ISO = NOW.toISOString();

const createHike = (hikeId, hoursAgo = 3) => ({
    hikeId,
    expectedArrival: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
});

const sampleHike = {
    hikeId: 10,
    hiker: {
        name: 'Mario Rossi',
        email: 'mario@example.com',
        phone: '3331234567',
        emergencyContact: '3339876543',
    },
    destination: 'Monte Viso',
    route: 'Pian del Re - Summit',
    partySize: 2,
    expectedArrival: '2028-06-10T09:00:00.000Z',
};

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    stopMissingHikeJob();
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

describe('missingHikeJob', () => {

    // ---------------------------------------------------------
    // computeDueAlerts
    // ---------------------------------------------------------

    describe('computeDueAlerts', () => {

        it('returns the first alert when a hike is overdue by 2 hours', () => {
            const overdueHikes = [createHike(1, 2)];

            expect(computeDueAlerts(overdueHikes, [], NOW.getTime())).toEqual([
                { hikeId: 1, alertNumber: 1 },
            ]);
        });

        it('returns no alert when the hike is overdue by less than 2 hours', () => {
            const overdueHikes = [createHike(1, 1.5)];

            expect(computeDueAlerts(overdueHikes, [], NOW.getTime())).toEqual([]);
        });

        it('returns no alert when the hike has not reached its expected arrival time', () => {
            const overdueHikes = [
                {
                    hikeId: 1,
                    expectedArrival: new Date(NOW.getTime() + HOUR).toISOString(),
                },
            ];

            expect(computeDueAlerts(overdueHikes, [], NOW.getTime())).toEqual([]);
        });

        it('does not return the first alert one millisecond before the 2-hour threshold', () => {
            const overdueHikes = [createHike(1, 2)];

            const result = computeDueAlerts(
                overdueHikes,
                [],
                NOW.getTime() - 1
            );

            expect(result).toEqual([]);
        });

        it('returns the second alert when the hike is overdue by 3 hours', () => {
            const overdueHikes = [createHike(1, 3)];

            expect(computeDueAlerts(overdueHikes, [], NOW.getTime())).toEqual([
                { hikeId: 1, alertNumber: 2 },
            ]);
        });

        it('returns the fifth alert when the hike is overdue by 6 hours', () => {
            const overdueHikes = [createHike(1, 6)];

            expect(computeDueAlerts(overdueHikes, [], NOW.getTime())).toEqual([
                { hikeId: 1, alertNumber: MAX_ALERTS },
            ]);
        });

        it('does not create alerts beyond the maximum number of alerts', () => {
            const overdueHikes = [createHike(1, 10)];

            const existingAlerts = [
                { hikeId: 1, alertNumber: MAX_ALERTS },
            ];

            expect(
                computeDueAlerts(overdueHikes, existingAlerts, NOW.getTime())
            ).toEqual([]);
        });

        it('does not create an alert that has already been recorded', () => {
            const overdueHikes = [createHike(1, 3)];

            const existingAlerts = [
                { hikeId: 1, alertNumber: 2 },
            ];

            expect(
                computeDueAlerts(overdueHikes, existingAlerts, NOW.getTime())
            ).toEqual([]);
        });

        it('creates the next alert when the previous alert is recorded', () => {
            const overdueHikes = [createHike(1, 4)];

            const existingAlerts = [
                { hikeId: 1, alertNumber: 2 },
            ];

            expect(
                computeDueAlerts(overdueHikes, existingAlerts, NOW.getTime())
            ).toEqual([
                { hikeId: 1, alertNumber: 3 },
            ]);
        });

        it('returns only the currently due alert instead of creating all missed alerts', () => {
            const overdueHikes = [createHike(1, 6)];

            expect(
                computeDueAlerts(overdueHikes, [], NOW.getTime())
            ).toEqual([
                { hikeId: 1, alertNumber: 5 },
            ]);
        });

        it('handles multiple overdue hikes independently', () => {
            const overdueHikes = [
                createHike(1, 2),
                createHike(2, 3),
                createHike(3, 5),
                createHike(4, 1),
            ];

            expect(
                computeDueAlerts(overdueHikes, [], NOW.getTime())
            ).toEqual([
                { hikeId: 1, alertNumber: 1 },
                { hikeId: 2, alertNumber: 2 },
                { hikeId: 3, alertNumber: 4 },
            ]);
        });

        it('uses the last alert associated with each hike independently', () => {
            const overdueHikes = [
                createHike(1, 4),
                createHike(2, 3),
            ];

            const existingAlerts = [
                { hikeId: 1, alertNumber: 3 },
                { hikeId: 2, alertNumber: 1 },
            ];

            expect(
                computeDueAlerts(overdueHikes, existingAlerts, NOW.getTime())
            ).toEqual([
                { hikeId: 2, alertNumber: 2 },
            ]);
        });

        it('returns an empty array when there are no overdue hikes', () => {
            expect(computeDueAlerts([], [], NOW.getTime())).toEqual([]);
        });

        it('returns no alert for a hike with an invalid expected arrival date', () => {
            const overdueHikes = [
                { hikeId: 1, expectedArrival: 'invalid-date' },
            ];

            expect(
                computeDueAlerts(overdueHikes, [], NOW.getTime())
            ).toEqual([]);
        });
    });


    // ---------------------------------------------------------
    // buildAlertEmail
    // ---------------------------------------------------------

    describe('buildAlertEmail', () => {

        it('builds the correct email subject', () => {
            const result = buildAlertEmail(sampleHike, 1);

            expect(result.subject).toBe(
                '[Mountain Hut] Missing Hiker Alert #1 - Mario Rossi'
            );
        });

        it('includes all relevant hike and hiker information in the email', () => {
            const result = buildAlertEmail(sampleHike, 2);

            expect(result.text).toContain('Mario Rossi');
            expect(result.text).toContain('mario@example.com');
            expect(result.text).toContain('Monte Viso');
            expect(result.text).toContain('Pian del Re - Summit');
            expect(result.text).toContain('Party size: 2');
            expect(result.text).toContain('3331234567');
            expect(result.text).toContain('3339876543');
            expect(result.text).toContain('Alert number: 2 of 5');
        });

        it('includes the formatted expected arrival time', () => {
            const result = buildAlertEmail(sampleHike, 1);

            expect(result.text).toContain(
                new Date(sampleHike.expectedArrival).toLocaleString()
            );
        });

        it('uses N/A when the hiker has no phone number', () => {
            const hike = {
                ...sampleHike,
                hiker: {
                    ...sampleHike.hiker,
                    phone: null,
                },
            };

            const result = buildAlertEmail(hike, 1);

            expect(result.text).toContain('Hiker phone: N/A');
        });

        it('uses N/A when the hiker has no emergency contact', () => {
            const hike = {
                ...sampleHike,
                hiker: {
                    ...sampleHike.hiker,
                    emergencyContact: null,
                },
            };

            const result = buildAlertEmail(hike, 1);

            expect(result.text).toContain('Emergency contact: N/A');
        });

        it('includes the correct alert number in the subject and email body', () => {
            const result = buildAlertEmail(sampleHike, 5);

            expect(result.subject).toContain('Alert #5');
            expect(result.text).toContain('Alert number: 5 of 5');
        });
    });


    // ---------------------------------------------------------
    // createMissingAlerts
    // ---------------------------------------------------------

    describe('createMissingAlerts', () => {

        it('creates an alert for each due hike', async () => {
            const createAlert = vi.fn().mockResolvedValue(true);

            const dueAlerts = [
                { hikeId: 1, alertNumber: 1 },
                { hikeId: 2, alertNumber: 2 },
            ];

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await createMissingAlerts(dueAlerts, createAlert, NOW_ISO);

            expect(createAlert).toHaveBeenCalledTimes(2);

            expect(createAlert).toHaveBeenNthCalledWith(
                1, 1, 1, NOW_ISO
            );

            expect(createAlert).toHaveBeenNthCalledWith(
                2, 2, 2, NOW_ISO
            );

            logSpy.mockRestore();
        });

        it('does not log a message when an alert already exists', async () => {
            const createAlert = vi.fn().mockResolvedValue(false);
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await createMissingAlerts(
                [{ hikeId: 1, alertNumber: 1 }],
                createAlert,
                NOW_ISO
            );

            expect(createAlert).toHaveBeenCalledTimes(1);
            expect(logSpy).not.toHaveBeenCalled();

            logSpy.mockRestore();
        });

        it('does nothing when there are no due alerts', async () => {
            const createAlert = vi.fn();

            await createMissingAlerts([], createAlert, NOW_ISO);

            expect(createAlert).not.toHaveBeenCalled();
        });

        it('propagates database errors when creating an alert', async () => {
            const createAlert = vi.fn().mockRejectedValue(
                new Error('Database connection lost')
            );

            await expect(
                createMissingAlerts(
                    [{ hikeId: 1, alertNumber: 1 }],
                    createAlert,
                    NOW_ISO
                )
            ).rejects.toThrow('Database connection lost');
        });
    });


    // ---------------------------------------------------------
    // sendPendingAlertEmails
    // ---------------------------------------------------------

    describe('sendPendingAlertEmails', () => {

        it('sends an email to every warden for each pending hike', async () => {
            const sendEmail = vi.fn().mockResolvedValue(undefined);
            const markSent = vi.fn().mockResolvedValue(undefined);

            const hikes = [
                { ...sampleHike, alertNumber: 1 },
                {
                    ...sampleHike,
                    hikeId: 11,
                    alertNumber: 2,
                },
            ];

            const wardens = [
                'warden1@example.com',
                'warden2@example.com',
            ];

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await sendPendingAlertEmails(
                hikes,
                wardens,
                sendEmail,
                markSent,
                NOW_ISO
            );

            expect(sendEmail).toHaveBeenCalledTimes(4);

            expect(sendEmail).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: 'warden1@example.com',
                    subject: expect.stringContaining('Mario Rossi'),
                })
            );

            expect(sendEmail).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: 'warden2@example.com',
                })
            );

            expect(markSent).toHaveBeenCalledTimes(2);
            expect(markSent).toHaveBeenNthCalledWith(
                1, 10, 1, NOW_ISO
            );

            logSpy.mockRestore();
        });

        it('does not send emails or mark alerts when there are no wardens', async () => {
            const sendEmail = vi.fn();
            const markSent = vi.fn();

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await sendPendingAlertEmails(
                [{ ...sampleHike, alertNumber: 1 }],
                [],
                sendEmail,
                markSent,
                NOW_ISO
            );

            expect(sendEmail).not.toHaveBeenCalled();
            expect(markSent).not.toHaveBeenCalled();

            logSpy.mockRestore();
        });

        it('does nothing when there are no hikes with pending emails', async () => {
            const sendEmail = vi.fn();
            const markSent = vi.fn();

            await sendPendingAlertEmails(
                [],
                ['warden@example.com'],
                sendEmail,
                markSent,
                NOW_ISO
            );

            expect(sendEmail).not.toHaveBeenCalled();
            expect(markSent).not.toHaveBeenCalled();
        });

        it('continues sending emails to other wardens when one email fails', async () => {
            const sendEmail = vi.fn()
                .mockRejectedValueOnce(new Error('SMTP error'))
                .mockResolvedValueOnce(undefined);

            const markSent = vi.fn().mockResolvedValue(undefined);

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await sendPendingAlertEmails(
                [{ ...sampleHike, alertNumber: 1 }],
                ['warden1@example.com', 'warden2@example.com'],
                sendEmail,
                markSent,
                NOW_ISO
            );

            expect(sendEmail).toHaveBeenCalledTimes(2);

            expect(sendEmail).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    to: 'warden2@example.com',
                })
            );

            expect(errorSpy).toHaveBeenCalledTimes(1);

            logSpy.mockRestore();
            errorSpy.mockRestore();
        });

        it('continues processing other hikes when an email fails', async () => {
            const sendEmail = vi.fn()
                .mockRejectedValueOnce(new Error('SMTP error'))
                .mockResolvedValueOnce(undefined);

            const markSent = vi.fn().mockResolvedValue(undefined);

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await sendPendingAlertEmails(
                [
                    { ...sampleHike, alertNumber: 1 },
                    { ...sampleHike, hikeId: 11, alertNumber: 2 },
                ],
                ['warden@example.com'],
                sendEmail,
                markSent,
                NOW_ISO
            );

            expect(sendEmail).toHaveBeenCalledTimes(2);
            expect(markSent).toHaveBeenCalledTimes(2);

            logSpy.mockRestore();
            errorSpy.mockRestore();
        });

        it('continues processing when marking an email as sent fails', async () => {
            const sendEmail = vi.fn().mockResolvedValue(undefined);
            const markSent = vi.fn().mockRejectedValue(
                new Error('Database update failed')
            );

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await expect(
                sendPendingAlertEmails(
                    [{ ...sampleHike, alertNumber: 1 }],
                    ['warden@example.com'],
                    sendEmail,
                    markSent,
                    NOW_ISO
                )
            ).resolves.toBeUndefined();

            expect(sendEmail).toHaveBeenCalledTimes(1);
            expect(markSent).toHaveBeenCalledWith(10, 1, NOW_ISO);
            expect(errorSpy).toHaveBeenCalledTimes(1);

            errorSpy.mockRestore();
        });

        it('currently marks an alert as sent even when its email fails', async () => {
            const sendEmail = vi.fn().mockRejectedValue(
                new Error('SMTP error')
            );

            const markSent = vi.fn().mockResolvedValue(undefined);

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await sendPendingAlertEmails(
                [{ ...sampleHike, alertNumber: 1 }],
                ['warden@example.com'],
                sendEmail,
                markSent,
                NOW_ISO
            );

            expect(sendEmail).toHaveBeenCalledTimes(1);
            expect(markSent).toHaveBeenCalledTimes(1);

            logSpy.mockRestore();
            errorSpy.mockRestore();
        });
    });


    // ---------------------------------------------------------
    // checkMissingHikes
    // ---------------------------------------------------------

    describe('checkMissingHikes', () => {

        it('retrieves overdue hikes and existing alerts', async () => {
            const deps = {
                getOverdueScheduledHikes: vi.fn().mockResolvedValue([]),
                getMissingHikes: vi.fn().mockResolvedValue([]),
                createHikeAlert: vi.fn(),
                getHikesWithEmailToSend: vi.fn().mockResolvedValue([]),
                getWardenEmails: vi.fn().mockResolvedValue([]),
                sendEmail: vi.fn(),
                markAlertEmailSent: vi.fn(),
            };

            await checkMissingHikes(NOW, deps);

            expect(deps.getOverdueScheduledHikes).toHaveBeenCalledWith(NOW_ISO);
            expect(deps.getMissingHikes).toHaveBeenCalledTimes(1);
        });

        it('creates the due alerts and then retrieves pending emails', async () => {
            const createAlert = vi.fn().mockResolvedValue(true);

            const deps = {
                getOverdueScheduledHikes: vi.fn().mockResolvedValue([
                    createHike(1, 2),
                ]),
                getMissingHikes: vi.fn().mockResolvedValue([]),
                createHikeAlert: createAlert,
                getHikesWithEmailToSend: vi.fn().mockResolvedValue([]),
                getWardenEmails: vi.fn().mockResolvedValue([]),
                sendEmail: vi.fn(),
                markAlertEmailSent: vi.fn(),
            };

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await checkMissingHikes(NOW, deps);

            expect(createAlert).toHaveBeenCalledWith(1, 1, NOW_ISO);
            expect(deps.getHikesWithEmailToSend).toHaveBeenCalledTimes(1);
            expect(deps.getWardenEmails).toHaveBeenCalledTimes(1);

            logSpy.mockRestore();
        });

        it('sends pending emails after creating alerts', async () => {
            const sendEmail = vi.fn().mockResolvedValue(undefined);
            const markSent = vi.fn().mockResolvedValue(undefined);

            const deps = {
                getOverdueScheduledHikes: vi.fn().mockResolvedValue([]),
                getMissingHikes: vi.fn().mockResolvedValue([]),
                createHikeAlert: vi.fn(),
                getHikesWithEmailToSend: vi.fn().mockResolvedValue([
                    { ...sampleHike, alertNumber: 1 },
                ]),
                getWardenEmails: vi.fn().mockResolvedValue([
                    'warden@example.com',
                ]),
                sendEmail,
                markAlertEmailSent: markSent,
            };

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await checkMissingHikes(NOW, deps);

            expect(sendEmail).toHaveBeenCalledTimes(1);
            expect(markSent).toHaveBeenCalledWith(10, 1, NOW_ISO);

            logSpy.mockRestore();
        });

        it('does not create alerts when no hikes are overdue', async () => {
            const deps = {
                getOverdueScheduledHikes: vi.fn().mockResolvedValue([]),
                getMissingHikes: vi.fn().mockResolvedValue([]),
                createHikeAlert: vi.fn(),
                getHikesWithEmailToSend: vi.fn().mockResolvedValue([]),
                getWardenEmails: vi.fn().mockResolvedValue([]),
                sendEmail: vi.fn(),
                markAlertEmailSent: vi.fn(),
            };

            await checkMissingHikes(NOW, deps);

            expect(deps.createHikeAlert).not.toHaveBeenCalled();
        });

        it('propagates errors when retrieving overdue hikes fails', async () => {
            const deps = {
                getOverdueScheduledHikes: vi.fn().mockRejectedValue(
                    new Error('Database connection lost')
                ),
                getMissingHikes: vi.fn(),
            };

            await expect(checkMissingHikes(NOW, deps)).rejects.toThrow(
                'Database connection lost'
            );

            expect(deps.getMissingHikes).not.toHaveBeenCalled();
        });
    });


    // ---------------------------------------------------------
    // startMissingHikeJob and stopMissingHikeJob
    // ---------------------------------------------------------

    describe('startMissingHikeJob and stopMissingHikeJob', () => {

        it('schedules the job when started', () => {
            vi.useFakeTimers();
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '1');

            startMissingHikeJob();

            expect(vi.getTimerCount()).toBe(1);
        });

        it('does not start the job more than once', () => {
            vi.useFakeTimers();
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '1');

            startMissingHikeJob();
            startMissingHikeJob();

            expect(vi.getTimerCount()).toBe(1);
        });

        it('clears the scheduled timer when the job is stopped', () => {
            vi.useFakeTimers();
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '1');

            startMissingHikeJob();
            stopMissingHikeJob();

            expect(vi.getTimerCount()).toBe(0);
        });

        it('can be restarted after being stopped', () => {
            vi.useFakeTimers();
            vi.stubEnv('MISSING_HIKE_TIME_SCALE', '1');

            startMissingHikeJob();
            stopMissingHikeJob();

            startMissingHikeJob();

            expect(vi.getTimerCount()).toBe(1);
        });

        it('does not schedule a timer when the job is stopped before starting', () => {
            vi.useFakeTimers();

            stopMissingHikeJob();

            expect(vi.getTimerCount()).toBe(0);
        });
    });
});
