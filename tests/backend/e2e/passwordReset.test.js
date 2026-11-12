import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, vi } from 'vitest';

const BACKEND_URL = 'http://localhost:3002'; // PORT, see backend/vitest.config.js

// Recreate the e2e database (DB_PATH, see backend/vitest.config.js) from the demo data, then start the backend
beforeAll(async () => {
    execFileSync('node', ['db/init-db.js', '--reset'], { cwd: new URL('../../../backend', import.meta.url) });
    await import('../../../backend/index.js');
});

// Without SMTP credentials (MAIL_USER is empty, see backend/vitest.config.js) the email is printed:
// read the token of the reset link from the console
async function requestResetLink(email) {
    const log = vi.spyOn(console, 'log');
    const res = await request(BACKEND_URL).post("/api/users/password-reset").send({ email });
    const printed = log.mock.calls.flat().join('\n');
    log.mockRestore();

    expect(res.status).toBe(204);
    return printed.match(/reset-password\?token=([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

describe("Password recovery e2e", () => {
    it("Should let the hiker choose a new password with the emailed link, only once", async () => {
        const token = await requestResetLink("edward@mountainhut.test");
        expect(token).not.toBeNull();

        // The old password keeps working until the link is used
        expect((await request(BACKEND_URL).post("/api/sessions").send({ email: "edward@mountainhut.test", password: "password" })).status).toBe(201);

        const confirm = await request(BACKEND_URL).post("/api/users/password-reset/confirm").send({ token, newPassword: "new-secret" });
        expect(confirm.status).toBe(204);

        const oldLogin = await request(BACKEND_URL).post("/api/sessions").send({ email: "edward@mountainhut.test", password: "password" });
        const newLogin = await request(BACKEND_URL).post("/api/sessions").send({ email: "edward@mountainhut.test", password: "new-secret" });
        expect(oldLogin.status).toBe(401);
        expect(newLogin.status).toBe(201);

        const again = await request(BACKEND_URL).post("/api/users/password-reset/confirm").send({ token, newPassword: "other-secret" });
        expect(again.status).toBe(400);
        expect(again.body.error).toBe("INVALID_OR_EXPIRED_TOKEN");
    });

    it("Should give back 204 without sending a link when the email is not registered", async () => {
        expect(await requestResetLink("nobody@example.com")).toBeNull();
    });
});