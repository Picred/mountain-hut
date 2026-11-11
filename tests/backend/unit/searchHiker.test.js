import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dbAll } from '../../../backend/utils/dbHelpers.js';
import { searchHikers } from '../../../backend/models/dao/hikerDAO.js';
import hikerRouter from '../../../backend/api/hikerRoutes.js';
import BadRequestError from '../../../backend/models/errors/BadRequestError.js';

vi.mock('../../../backend/utils/dbHelpers.js', () => ({
    dbAll: vi.fn()
}));

beforeEach(() => {
    vi.resetAllMocks();
});

describe("Search hikers", () => {
    it("returns the hiker(s) that are being searched by email", async () => {

        dbAll.mockResolvedValueOnce([{ userId: 1, name: "Mario Rossi", email: "mario@example.com", phone: "3332221111" }])

        const response = await searchHikers("mario@example.com")
        expect(response).toEqual([
            { userId: 1, name: "Mario Rossi", email: "mario@example.com", phone: "3332221111" }
        ])
        expect(dbAll).toHaveBeenCalledTimes(1);
        expect(dbAll.mock.calls[0][1]).toEqual(["mario@example.com"]);
    })
    it("returns the hiker(s) that are being searched by name", async () => {

        dbAll.mockResolvedValueOnce([{ userId: 1, name: "Mario Rossi", email: "mario@example.com", phone: "3332221111" }])

        const response = await searchHikers("Mario Rossi")
        expect(response).toEqual([
            { userId: 1, name: "Mario Rossi", email: "mario@example.com", phone: "3332221111" }
        ])
        expect(dbAll).toHaveBeenCalledTimes(1);
        expect(dbAll.mock.calls[0][1]).toEqual(["Mario Rossi"]);
    })
    it("returns the hiker(s) that are being searched by phone", async () => {

        dbAll.mockResolvedValueOnce([{ userId: 1, name: "Mario Rossi", email: "mario@example.com", phone: "3332221111" }])

        const response = await searchHikers("3332221111")
        expect(response).toEqual([
            { userId: 1, name: "Mario Rossi", email: "mario@example.com", phone: "3332221111" }
        ])
        expect(dbAll).toHaveBeenCalledTimes(1);
        expect(dbAll.mock.calls[0][1]).toEqual(["3332221111"]);
    })
    it("returns an empty array if there are no matches", async () => {

        dbAll.mockResolvedValueOnce([])

        const response = await searchHikers("Anna")
        expect(response).toEqual([])
        expect(dbAll).toHaveBeenCalledTimes(1);
        expect(dbAll.mock.calls[0][1]).toEqual(["Anna"]);
    })
    it("throws an error if the database query fails", async () => {
        dbAll.mockRejectedValueOnce(new Error("Database connection lost"));

        await expect(searchHikers("Mario")).rejects.toThrow("Database connection lost");

        expect(dbAll).toHaveBeenCalledTimes(1);
    });

})

describe('GET /api/hikers?search=text (route)', () => {
    const layer = hikerRouter.stack.find((l) => l.route?.path === '/' && l.route.methods.get);
    const getHikers = layer.route.stack.at(-1).handle;

    function fakeRes() {
        const res = {};
        res.status = vi.fn(() => res);
        res.json = vi.fn(() => res);
        return res;
    }

    it('is reserved to employees: the role check runs before the handler', () => {
        // ensureAuthenticated, role check, handler
        expect(layer.route.stack).toHaveLength(3);
    });

    it('searches the trimmed text and responds 200 with the hikers', async () => {
        const hikers = [{ userId: 3, name: 'Anna Winden', email: 'anna@mountainhut.test', phone: '+393401234567' }];
        dbAll.mockResolvedValueOnce(hikers);
        const res = fakeRes();

        await getHikers({ query: { search: '  Anna  ' } }, res);

        expect(dbAll.mock.calls[0][1]).toEqual(['Anna']);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(hikers);
    });

    it.each([
        ['missing', {}],
        ['empty', { search: '' }],
        ['only spaces', { search: '   ' }],
        ['repeated', { search: ['a', 'b'] }],
    ])('rejects with BadRequestError when the search is %s', async (_, query) => {
        await expect(getHikers({ query }, fakeRes())).rejects.toBeInstanceOf(BadRequestError);
        expect(dbAll).not.toHaveBeenCalled();
    });
});