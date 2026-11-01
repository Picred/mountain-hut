import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';

// The real backend runs on a temporary copy of the demo database (backend/db/init-db.js):
// routes, passport, session, DAO and SQLite are all real, nothing is mocked.
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const PORT = 3103;
const BASE_URL = `http://localhost:${PORT}`;


const CARL_empl = "employee@mountainhut.test"
const ANNA_hiker = "anna@mountainhut.test"

let tmpDir;
let db;
let server;
let seed;

function startServer(dbPath) {
    return new Promise((resolve, reject) => {
        const proc = spawn('node', ['index.js'], {
            cwd: BACKEND_DIR,
            env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT) },
        });
        proc.stdout.on('data', (chunk) => {
            if (chunk.toString().includes('backend running')) resolve(proc);
        });
        proc.on('exit', (code) => reject(new Error(`backend exited with code ${code}`)));
    });
}

async function loginAs(email) {
    const res = await fetch(`${BASE_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password' }),
    });
    expect(res.status).toBe(201);
    return res.headers.getSetCookie()[0].split(';')[0];
}
// YYYY-MM-DD in the server's timezone, as used by the API
function localDate(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const addHours = (iso, hours) => new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString();


beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mountain-hut-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');
    execFileSync('node', ['db/init-db.js'], { cwd: BACKEND_DIR, env: { ...process.env, DB_PATH: dbPath } });

    db = new DatabaseSync(dbPath);
    seed = db.prepare(`
    SELECT (SELECT MAX(reservation_id) FROM reservations) AS reservationId,
           (SELECT MAX(slot_id) FROM slots) AS slotId,
           (SELECT MAX(slot_table_id) FROM slot_tables) AS slotTableId,
           (SELECT MAX(table_id) FROM tables) AS tableId
  `).get();

    server = await startServer(dbPath);
}, 20000);

// Every test starts from the demo data: remove what the previous test created
afterEach(() => {
    db.prepare('DELETE FROM reservation_table WHERE reservation_id > ?').run(seed.reservationId);
    db.prepare('DELETE FROM reservations WHERE reservation_id > ?').run(seed.reservationId);
    db.prepare('DELETE FROM slot_tables WHERE slot_id > ?').run(seed.slotId);
    db.prepare('DELETE FROM slots WHERE slot_id > ?').run(seed.slotId);
});

afterAll(async () => {
    db?.close();
    if (server) {
        server.kill();
        await once(server, 'exit');
    }
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
});

describe("GET /api/slots/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD", () => {
    it('returns all slots ordered by start time', async () => {
        const cookie = await loginAs(CARL_empl);
        const { start_at } = db.prepare('SELECT start_at FROM slots WHERE slot_id = 1').get();
        const day = localDate(start_at);
        const params = new URLSearchParams({ from: day, to: day });

        const res = await fetch(`${BASE_URL}/api/slots/capacity?${params}`, {
            headers: { Cookie: cookie },
        });
        const slots = await res.json();

        expect(res.status).toBe(200);
        expect(slots.map((s) => s.slotId).sort()).toEqual([1, 2, 3]); // slot 4 is two days later, so it must be excluded
    });
    it('return 401 if the user is not logged in', async () => {
        const { start_at } = db.prepare('SELECT start_at FROM slots WHERE slot_id = 1').get();
        const day = localDate(start_at);
        const params = new URLSearchParams({ from: day, to: day });

        const res = await fetch(`${BASE_URL}/api/slots/capacity?${params}`);
        const slots = await res.json();

        expect(res.status).toBe(401);
    });

    it('returns 400 if the "from" date is invalid', async () => {
        const cookie = await loginAs(CARL_empl);
        const { start_at } = db.prepare('SELECT start_at FROM slots WHERE slot_id = 1').get();
        const day = localDate(start_at);
        const params = new URLSearchParams({ from: "invalid_date", to: day });

        const res = await fetch(`${BASE_URL}/api/slots/capacity?${params}`, {
            headers: { Cookie: cookie },
        });
        const slots = await res.json();

        expect(res.status).toBe(400);
    });

    it('returns 400 if the "to" date is invalid', async () => {
        const cookie = await loginAs(CARL_empl);
        const { start_at } = db.prepare('SELECT start_at FROM slots WHERE slot_id = 1').get();
        const day = localDate(start_at);
        const params = new URLSearchParams({ from: day, to: "invalid_date" });

        const res = await fetch(`${BASE_URL}/api/slots/capacity?${params}`, {
            headers: { Cookie: cookie },
        });
        const slots = await res.json();

        expect(res.status).toBe(400);
    });

    it('returns 400 if the date range is invalid', async () => {
        const cookie = await loginAs(CARL_empl);
        const { start_at } = db.prepare('SELECT start_at FROM slots WHERE slot_id = 1').get();
        const dayBefore = new Date(start_at);
        dayBefore.setDate(dayBefore.getDate() - 1);

        const day = localDate(start_at);
        const yesterday = localDate(dayBefore);
        const params = new URLSearchParams({ from: day, to: yesterday });

        const res = await fetch(`${BASE_URL}/api/slots/capacity?${params}`, {
            headers: { Cookie: cookie },
        });
        const slots = await res.json();

        expect(res.status).toBe(400);
    });

    it('returns 403 if an hiker tries to get the slots', async () => {
        const cookie = await loginAs(ANNA_hiker);
        const { start_at } = db.prepare('SELECT start_at FROM slots WHERE slot_id = 1').get();
        const day = localDate(start_at);
        const params = new URLSearchParams({ from: day, to: day });

        const res = await fetch(`${BASE_URL}/api/slots/capacity?${params}`, {
            headers: { Cookie: cookie },
        });
        const slots = await res.json();

        expect(res.status).toBe(403);
    });
})

describe("POST api/slots", () => {
    it("creates a new time slot", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const res = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        expect(res.status).toBe(201)
        const slot = await res.json();
        expect(slot).toHaveProperty("slotId")
            .toHaveProperty("startAt", startAt)
            .toHaveProperty("endAt", endAt)
            .toHaveProperty("hasTables", false)
            .toHaveProperty("totalSeats", 0)
            .toHaveProperty("tables", [])
    })
    it("returns 400 if the 'startAt' input is invalid", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const endAt = addHours(end_at, 25);
        const res = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt: "invalid_input", endAt })
        });

        expect(res.status).toBe(400)
    })
    it("returns 400 if the 'endAt' input is invalid", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const res = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt: "invalid_input" })
        });

        expect(res.status).toBe(400)
    })
    it("returns 400 if the time range is invalid", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const res = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt: endAt, endAt: startAt })
        });

        expect(res.status).toBe(400)
    })
    it("returns 400 if the slot is in the past", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, -2000);
        const endAt = addHours(end_at, -1999);
        const res = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        expect(res.status).toBe(400)
    })
    it("returns 401 if the user is not authenticated", async () => {

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const res = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startAt, endAt })
        });

        expect(res.status).toBe(401)

    })
    it("returns 403 if an hiker tries to create a new slot", async () => {
        const cookie = await loginAs(ANNA_hiker)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const res = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        expect(res.status).toBe(403)
    })
    it("returns 409 if the slot hours go in conflict with another time slot", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, -25);
        const endAt = addHours(end_at, -24);
        const res = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        expect(res.status).toBe(409)
    })
})
describe("POST /api/slots/:id/tables", () => {
    it("adds the tables to an existing slot", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const resp = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        const s = await resp.json()

        const res = await fetch(`${BASE_URL}/api/slots/${s.slotId}/tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ tableIds: [1, 2, 3] })
        })

        expect(res.status).toBe(201)

        const slot = await res.json()
        expect(slot.tables).toMatchObject([
            { tableId: 1, code: 'T1', seats: 4 },
            { tableId: 2, code: 'T2', seats: 4 },
            { tableId: 3, code: 'T3', seats: 6 },
        ]);
    })

    it("returns 400 if the slot id is not valid", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/slots/invalidSlot/tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ tableIds: [1, 2, 3] })
        })

        expect(res.status).toBe(400)

    })

    it("ignores a table id that appears twice in the request", async () => {
        const cookie = await loginAs(CARL_empl);

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const resSlot = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt: addHours(end_at, 24), endAt: addHours(end_at, 25) })
        });
        const s = await resSlot.json();

        const res = await fetch(`${BASE_URL}/api/slots/${s.slotId}/tables`, {
            method: 'POST',
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ tableIds: [1, 2, 2] })
        });
        const slot = await res.json();

        expect(res.status).toBe(201);
        expect(slot.tables.map((t) => t.tableId)).toEqual([1, 2]);
    });

    it("returns 400 if tableIds are not valid", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const resp = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        const s = await resp.json()

        const res = await fetch(`${BASE_URL}/api/slots/${s.slotId}/tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ tableIds: [-1, "Carla", "?"] })
        })

        expect(res.status).toBe(400)
    })


    it("returns 401 if the user is not authenticated", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const resp = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        const s = await resp.json()

        const res = await fetch(`${BASE_URL}/api/slots/${s.slotId}/tables`, {
            method: "POST",
            headers: { "Content-type": "application/json" },
            body: JSON.stringify({ tableIds: [1, 2, 3] })
        })

        expect(res.status).toBe(401)

    })

    it("returns 403 if a hiker tries to add tables to a slot", async () => {
        const cookie = await loginAs(CARL_empl)
        const hcookie = await loginAs(ANNA_hiker)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const resp = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        const s = await resp.json()

        const res = await fetch(`${BASE_URL}/api/slots/${s.slotId}/tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: hcookie },
            body: JSON.stringify({ tableIds: [1, 2, 3] })
        })

        expect(res.status).toBe(403)
    })

    it("returns 404 if the slot is not found", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/slots/999999999/tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ tableIds: [1, 2, 3] })
        })

        expect(res.status).toBe(404)
    })

    it("returns 404 if one or more table configurations are not found", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const resp = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        const s = await resp.json()

        const res = await fetch(`${BASE_URL}/api/slots/${s.slotId}/tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ tableIds: [999999, 2, 3] })
        })

        expect(res.status).toBe(404)
    })

    it("returns 409 if the slot already has reservations", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/slots/4/tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ tableIds: [2] })
        })

        expect(res.status).toBe(409)
    })

    it("returns 409 if the table is already present in that slot", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/slots/1/tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ tableIds: [1] })
        })

        expect(res.status).toBe(409)

    })
    it("returns 400 if two selected tables have the same code", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const resp = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        const s = await resp.json()

        // same code, different seats: allowed in the catalogue, but not together in the same slot
        const insertTable = db.prepare('INSERT INTO tables (table_code, seats) VALUES (?, ?)');
        const a = Number(insertTable.run('DUP', 4).lastInsertRowid);
        const b = Number(insertTable.run('DUP', 6).lastInsertRowid);

        const res = await fetch(`${BASE_URL}/api/slots/${s.slotId}/tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ tableIds: [a, b] })
        })

        expect(res.status).toBe(400)

        // nothing must be saved, not even the first table
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM slot_tables WHERE slot_id = ?').get(s.slotId);
        expect(n).toBe(0)
    })
})

describe("POST /api/slots/:id/copy-tables", async () => {

    it("Copies the tables of another slot into this slot", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const resp = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        const s = await resp.json()

        const res = await fetch(`${BASE_URL}/api/slots/${s.slotId}/copy-tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ fromSlotId: 1 })
        })

        expect(res.status).toBe(201)

        const slot = await res.json()
        expect(slot.tables).toMatchObject([
            { tableId: 1, code: 'T1', seats: 4 },
            { tableId: 2, code: 'T2', seats: 4 },
            { tableId: 3, code: 'T3', seats: 6 },
            { tableId: 4, code: 'T4', seats: 2 },
            { tableId: 5, code: 'T5', seats: 2 },
        ]);

    })

    it("returns 400 if the input is invalid", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const resp = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        const s = await resp.json()

        const res = await fetch(`${BASE_URL}/api/slots/${s.slotId}/copy-tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ fromSlotId: "invalid" })
        })

        expect(res.status).toBe(400)

    })

    it("returns 400 if it is the slot were the table are taken and the one where they are copied are the same", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/slots/1/copy-tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ fromSlotId: 1 })
        })

        expect(res.status).toBe(400)
    })
    it("returns 400 if the slot where i take tables has no tables", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const resp = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        const s = await resp.json()

        const res = await fetch(`${BASE_URL}/api/slots/3/copy-tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ fromSlotId: s.slotId })
        })

        expect(res.status).toBe(400)
    })

    it("returns 401 if the user is not logged in", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const resp = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        const s = await resp.json()

        const res = await fetch(`${BASE_URL}/api/slots/${s.slotId}/copy-tables`, {
            method: "POST",
            headers: { "Content-type": "application/json" },
            body: JSON.stringify({ fromSlotId: 1 })
        })

        expect(res.status).toBe(401)

    })

    it("returns 403 if a hiker tries to copy the tables", async () => {
        const cookie = await loginAs(CARL_empl)
        const hcookie = await loginAs(ANNA_hiker)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const resp = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        const s = await resp.json()

        const res = await fetch(`${BASE_URL}/api/slots/${s.slotId}/copy-tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: hcookie },
            body: JSON.stringify({ fromSlotId: 1 })
        })

        expect(res.status).toBe(403)
    })

    it("returns 404 if the destination slot is not found", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/slots/99999/copy-tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ fromSlotId: 1 })
        })

        expect(res.status).toBe(404)

    })

    it("returns 404 if the source slot is not found", async () => {
        const cookie = await loginAs(CARL_empl)

        const { end_at } = db.prepare('SELECT MAX(end_at) AS end_at FROM slots').get();
        const startAt = addHours(end_at, 24);
        const endAt = addHours(end_at, 25);
        const resp = await fetch(`${BASE_URL}/api/slots`, {
            method: 'POST',

            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ startAt, endAt })
        });

        const s = await resp.json()

        const res = await fetch(`${BASE_URL}/api/slots/${s.slotId}/copy-tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ fromSlotId: 99999 })
        })

        expect(res.status).toBe(404)

    })

    it("returns 409 if the slot has reservations", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/slots/2/copy-tables`, {
            method: "POST",
            headers: { "Content-type": "application/json", Cookie: cookie },
            body: JSON.stringify({ fromSlotId: 1 })
        })

        expect(res.status).toBe(409)
    })

})

describe("GET /api/tables", () => {
    it("retrieves the catalogue of table types", async () => {
        const cookie = await loginAs(CARL_empl);

        const res = await fetch(`${BASE_URL}/api/tables`, {
            headers: { Cookie: cookie },
        });
        const tables = await res.json();

        expect(res.status).toBe(200);
        expect(Array.isArray(tables)).toBe(true);

        // same number of tables as in the database
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM tables').get();
        expect(tables).toHaveLength(n);

        // every element has the expected fields and types
        for (const table of tables) {
            expect(table).toEqual({
                tableId: expect.any(Number),
                code: expect.any(String),
                seats: expect.any(Number),
            });
        }
    });

    it("returns 401 if the user is not authenticated", async () => {
        const cookie = await loginAs(ANNA_hiker)

        const res = await fetch(`${BASE_URL}/api/tables`);

        expect(res.status).toBe(401)

    })

    it("returns 403 if a hiker tries to access the table list", async () => {
        const cookie = await loginAs(ANNA_hiker)

        const res = await fetch(`${BASE_URL}/api/tables`, {
            headers: { Cookie: cookie },
        });

        expect(res.status).toBe(403)

    })
})

describe("POST /api/tables", () => {
    it("creates a new table type", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/tables`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ code: "T10", seats: 6 })
        })

        expect(res.status).toBe(201)

        const table = await res.json()
        expect(table).toEqual({ tableId: expect.any(Number), code: "T10", seats: 6 })

        const saved = db.prepare('SELECT table_code, seats FROM tables WHERE table_id = ?').get(table.tableId)
        expect(saved.table_code).toBe("T10")
        expect(saved.seats).toBe(6)
    })

    it("allows a code that already exists if the number of seats is different", async () => {
        const cookie = await loginAs(CARL_empl)

        // T1 already exists in the demo data with 4 seats
        const res = await fetch(`${BASE_URL}/api/tables`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ code: "T1", seats: 8 })
        })

        expect(res.status).toBe(201)
    })

    it("returns 400 if the code is missing", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/tables`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ seats: 4 })
        })

        expect(res.status).toBe(400)
    })

    it("returns 400 if the code is empty", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/tables`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ code: "   ", seats: 4 })
        })

        expect(res.status).toBe(400)
    })

    it("returns 400 if the code is longer than 20 characters", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/tables`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ code: "A".repeat(21), seats: 4 })
        })

        expect(res.status).toBe(400)
    })

    it("returns 400 if the seats are missing", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/tables`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ code: "T11" })
        })

        expect(res.status).toBe(400)
    })

    it("returns 400 if the seats are less than 1", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/tables`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ code: "T11", seats: 0 })
        })

        expect(res.status).toBe(400)
    })

    it("returns 400 if the seats are more than 100", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/tables`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ code: "T11", seats: 101 })
        })

        expect(res.status).toBe(400)
    })

    it("returns 400 if the seats are not an integer", async () => {
        const cookie = await loginAs(CARL_empl)

        const res = await fetch(`${BASE_URL}/api/tables`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ code: "T11", seats: 2.5 })
        })

        expect(res.status).toBe(400)
    })

    it("returns 401 if the user is not authenticated", async () => {
        const res = await fetch(`${BASE_URL}/api/tables`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: "T11", seats: 4 })
        })

        expect(res.status).toBe(401)
    })

    it("returns 403 if a hiker tries to create a table", async () => {
        const cookie = await loginAs(ANNA_hiker)

        const res = await fetch(`${BASE_URL}/api/tables`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ code: "T11", seats: 4 })
        })

        expect(res.status).toBe(403)
    })

    it("returns 409 if a table with the same code and seats already exists", async () => {
        const cookie = await loginAs(CARL_empl)

        // T1 with 4 seats is part of the demo data
        const res = await fetch(`${BASE_URL}/api/tables`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ code: "T1", seats: 4 })
        })

        expect(res.status).toBe(409)
    })
})
