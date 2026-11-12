import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replace external modules with mocks so tests run without SQLite files
vi.mock('sqlite3', () => {
    const Database = vi.fn(function () {
        this.close = vi.fn((callback) => callback(null));
    });

    return {
        default: {
            Database,
            OPEN_READWRITE: 2
        }
    };
});

vi.mock('../../../backend/utils/dbHelpers.js', () => ({
    dbAll: vi.fn(),
    dbGet: vi.fn(),
    dbRun: vi.fn()
}));


vi.mock('../../../backend/models/dao/reservationDAO.js', () => ({
    makeReservation: vi.fn(),
    updateReservation: vi.fn(),
    cancelReservation: vi.fn()
}));

vi.mock('../../../backend/services/confirmation.js', () => ({
    sendBookingConfirmation: vi.fn(),
    sendChangesConfirmation: vi.fn(),
    sendCancellationConfirmation: vi.fn()
}));

import { dbGet, dbRun } from '../../../backend/utils/dbHelpers.js';

import BadRequestError from '../../../backend/models/errors/BadRequestError.js';
import ConflictError from '../../../backend/models/errors/ConflictError.js';
import ForbiddenError from '../../../backend/models/errors/ForbiddenError.js';
import NotFoundError from '../../../backend/models/errors/NotFoundError.js';

import { cancelReservation as cancelReservationMock } from '../../../backend/models/dao/reservationDAO.js';
import { sendCancellationConfirmation } from '../../../backend/services/confirmation.js';
import router from '../../../backend/api/reservationRoutes.js';
import UnauthorizedError from '../../../backend/models/errors/UnauthorizedError.js';

// Import actual DAO implementation to test transaction handling
const { cancelReservation } = await vi.importActual(
    '../../../backend/models/dao/reservationDAO.js'
);

// Pull the handler out of express router stack to call it directly
function handler(method, path = '/') {
    const layer = router.stack.find(
        (l) => l.route?.path === path && l.route.methods[method]
    );
    return layer.route.stack.at(-1).handle;
}

function fakeRes() {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    res.end = vi.fn(() => res);
    return res;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('cancelReservation', () => {

    it('rejects with BadRequestError when input parameters are invalid', async () => {
        // Input validation happens before opening any database transaction
        await expect(cancelReservation(0, 1)).rejects.toBeInstanceOf(BadRequestError);
        await expect(cancelReservation(-1, 1)).rejects.toBeInstanceOf(BadRequestError);
        await expect(cancelReservation('1', 1)).rejects.toBeInstanceOf(BadRequestError);
        await expect(cancelReservation(1, 0)).rejects.toBeInstanceOf(BadRequestError);
        await expect(cancelReservation(1, -1)).rejects.toBeInstanceOf(BadRequestError);
        await expect(cancelReservation(1, '1')).rejects.toBeInstanceOf(BadRequestError);

        expect(dbRun).not.toHaveBeenCalled();
    });

    it('rejects with NotFoundError when the reservation does not exist', async () => {
        dbRun.mockResolvedValue({ changes: 1 });
        dbGet.mockResolvedValue(null);

        await expect(cancelReservation(99, 1)).rejects.toBeInstanceOf(NotFoundError);

        expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
        expect(dbRun).not.toHaveBeenCalledWith('COMMIT', [], expect.anything());
    });

    it('rejects with ForbiddenError when the reservation belongs to another user', async () => {
        // User 5 cannot cancel a reservation owned by user 10
        dbRun.mockResolvedValue({ changes: 1 });
        dbGet.mockResolvedValue({
            reservationId: 42,
            userId: 10,
            status: 'confirmed'
        });

        await expect(cancelReservation(42, 5)).rejects.toBeInstanceOf(ForbiddenError);

        expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
        expect(dbRun).not.toHaveBeenCalledWith('COMMIT', [], expect.anything());
    });

    it('rejects with ConflictError(RESERVATION_NOT_CANCELLABLE) when the reservation is already cancelled', async () => {
        dbRun.mockResolvedValue({ changes: 1 });
        dbGet.mockResolvedValue({
            reservationId: 42,
            userId: 5,
            status: 'cancelled'
        });

        await expect(cancelReservation(42, 5)).rejects.toSatisfy(
            (err) => err instanceof ConflictError &&
                err.message === 'RESERVATION_NOT_CANCELLABLE'
        );

        expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
    });

    it('rejects with ConflictError(RESERVATION_NOT_CANCELLABLE) when the reservation has an invalid status', async () => {
        dbRun.mockResolvedValue({ changes: 1 });
        dbGet.mockResolvedValue({
            reservationId: 42,
            userId: 5,
            status: 'completed'
        });

        await expect(cancelReservation(42, 5)).rejects.toSatisfy(
            (err) => err instanceof ConflictError &&
                err.message === 'RESERVATION_NOT_CANCELLABLE'
        );

        expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
    });

    it.each(['confirmed', 'waiting'])(
        'cancels a reservation with status %s and commits the transaction',
        async (status) => {
            dbRun.mockResolvedValue({ changes: 1 });
            dbGet.mockResolvedValue({
                reservationId: 42,
                userId: 5,
                status
            });

            const result = await cancelReservation(42, 5);

            expect(result).toEqual({
                reservationId: 42,
                status: 'cancelled'
            });

            // Release allocated tables before updating the reservation status
            const deleteCall = dbRun.mock.calls.findIndex(
                ([sql]) => sql.includes('DELETE FROM reservation_table')
            );
            const updateCall = dbRun.mock.calls.findIndex(
                ([sql]) => sql.includes('UPDATE reservations')
            );

            expect(deleteCall).toBeGreaterThan(-1);
            expect(updateCall).toBeGreaterThan(deleteCall);

            expect(dbRun.mock.calls[deleteCall][1]).toEqual([42]);
            expect(dbRun.mock.calls[updateCall][1]).toEqual([42]);

            expect(dbRun).toHaveBeenCalledWith('BEGIN IMMEDIATE', [], expect.anything());
            expect(dbRun).toHaveBeenCalledWith('COMMIT', [], expect.anything());
            expect(dbRun).not.toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
        }
    );

    it('rolls back the transaction when deleting table allocations fails', async () => {
        dbGet.mockResolvedValue({
            reservationId: 42,
            userId: 5,
            status: 'confirmed'
        });

        dbRun.mockImplementation(async (sql) => {
            if (sql.includes('DELETE FROM reservation_table')) {
                throw new Error('SQLITE_ERROR: deletion failed');
            }
            return { changes: 1 };
        });

        await expect(cancelReservation(42, 5))
            .rejects.toThrow('SQLITE_ERROR: deletion failed');

        expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
        expect(dbRun).not.toHaveBeenCalledWith('COMMIT', [], expect.anything());
    });

    it('rolls back the transaction when updating reservation status fails', async () => {
        dbGet.mockResolvedValue({
            reservationId: 42,
            userId: 5,
            status: 'confirmed'
        });

        dbRun.mockImplementation(async (sql) => {
            if (sql.includes('UPDATE reservations')) {
                throw new Error('SQLITE_ERROR: update failed');
            }
            return { changes: 1 };
        });

        await expect(cancelReservation(42, 5))
            .rejects.toThrow('SQLITE_ERROR: update failed');

        expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
        expect(dbRun).not.toHaveBeenCalledWith('COMMIT', [], expect.anything());
    });

    /*
     * Optional cancellation time restriction.
     *
     * Enable this test only if the cancellation time constraint
     * is introduced in cancelReservation().
     *
     * Cancellation should be forbidden once the booked slot has started.
     *
     * it('rejects with ConflictError(RESERVATION_ALREADY_STARTED) when the slot has started', async () => {
     *   dbRun.mockResolvedValue({ changes: 1 });
     *   dbGet.mockResolvedValue({
     *     reservationId: 42,
     *     userId: 5,
     *     status: 'confirmed',
     *     startAt: new Date(Date.now() - 60000).toISOString()
     *   });
     *
     *   await expect(cancelReservation(42, 5)).rejects.toSatisfy(
     *     (err) => err instanceof ConflictError &&
     *       err.message === 'RESERVATION_ALREADY_STARTED'
     *   );
     *
     *   expect(dbRun).toHaveBeenCalledWith('ROLLBACK', [], expect.anything());
     * }
     */
});


describe('reservationRoutes', () => {
    describe('DELETE /api/reservations/:reservationId', () => {
        const deleteReservation = handler('delete', '/:reservationId');

        it('rejects with UnauthorizedError when the user is not authenticated', async () => {
            const req = {
                user: null,
                params: { reservationId: '42' }
            };
            const res = fakeRes();

            await expect(deleteReservation(req, res))
                .rejects.toBeInstanceOf(UnauthorizedError);

            expect(cancelReservationMock).not.toHaveBeenCalled();
            expect(sendCancellationConfirmation).not.toHaveBeenCalled();
        });

        it.each(['0', '-1', 'abc', '1.5', 'NaN'])(
            'rejects with BadRequestError when reservationId is %s',
            async (reservationId) => {
                const req = {
                    user: { user_id: 5 },
                    params: { reservationId }
                };
                const res = fakeRes();

                await expect(deleteReservation(req, res))
                    .rejects.toBeInstanceOf(BadRequestError);

                expect(cancelReservationMock).not.toHaveBeenCalled();
                expect(sendCancellationConfirmation).not.toHaveBeenCalled();
            }
        );

        it('cancels the reservation and responds 200 with the cancelled reservation', async () => {
            const cancelledReservation = {
                reservationId: 42,
                status: 'cancelled'
            };

            cancelReservationMock.mockResolvedValue(cancelledReservation);

            const req = {
                user: { user_id: 5 },
                params: { reservationId: '42' }
            };
            const res = fakeRes();

            await deleteReservation(req, res);

            expect(cancelReservationMock).toHaveBeenCalledWith(42, 5);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(cancelledReservation);
        });

        it('sends a cancellation confirmation email after a successful cancellation', async () => {
            cancelReservationMock.mockResolvedValue({
                reservationId: 42,
                status: 'cancelled'
            });

            const req = {
                user: { user_id: 5 },
                params: { reservationId: '42' }
            };
            const res = fakeRes();

            await deleteReservation(req, res);

            // The email service is called with the cancelled reservation ID
            expect(sendCancellationConfirmation).toHaveBeenCalledWith(42);
            expect(sendCancellationConfirmation).toHaveBeenCalledTimes(1);
        });

        it('does not send a confirmation email when cancellation fails', async () => {
            cancelReservationMock.mockRejectedValue(
                new ConflictError('RESERVATION_NOT_CANCELLABLE')
            );

            const req = {
                user: { user_id: 5 },
                params: { reservationId: '42' }
            };
            const res = fakeRes();

            await expect(deleteReservation(req, res)).rejects.toSatisfy(
                (err) => err instanceof ConflictError &&
                    err.message === 'RESERVATION_NOT_CANCELLABLE'
            );

            expect(sendCancellationConfirmation).not.toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
    });
});

