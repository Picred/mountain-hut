import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const BACKEND_URL = 'http://localhost:3002'; // PORT, see backend/vitest.config.js

// Recreate the e2e database (DB_PATH, see backend/vitest.config.js) from the demo data, then start the backend
beforeAll(async () => {
    execFileSync('node', ['db/init-db.js', '--reset'], { cwd: new URL('../../../backend', import.meta.url) });
    await import('../../../backend/index.js');
});

describe("Authentication e2e", () => {
    let agent;
    let testUser;

    beforeEach(() => {
        // Agent directly linked with the server
        agent = request.agent(BACKEND_URL);

        testUser = {
            name: "Mario Bianchi",
            email: `mario.${Date.now()}@example.com`,
            phone: "111222333444",
            password: "password123",
        };
    });

    // ---- Registrazione ----
    describe("POST /api/users (Registration)", () => {
        it("Should create a new user and give back 201", async () => {
            const res = await agent.post("/api/users").send(testUser);

            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty("user_id");
            expect(res.body.email).toBe(testUser.email);
        });

        it("Should give back 400 if a mandatory field is missing", async () => {
            const incompleteUser = {
                name: "Mario Bianchi",
                email: "marioB@example.com",
                phone: "111222333444"
            };

            const res = await agent.post("/api/users").send(incompleteUser);
            expect(res.status).toBe(400);
        });

        it("Should give back 400 if the password is shorter than 6 characters", async () => {
            const wrongPasswordUser = {
                ...testUser,
                password: "passw",
            };

            const res = await agent.post("/api/users").send(wrongPasswordUser);
            expect(res.status).toBe(400);
        });

        it("Should give back 409 if the email is already in use", async () => {
            await agent.post("/api/users").send(testUser);
            const res2 = await agent.post("/api/users").send(testUser);

            expect(res2.status).toBe(409);
        });
    });

    // ---- Login ----
    describe("POST /api/sessions (Login)", () => {
        it("Should give back 201 if the login is successful", async () => {
            await agent.post("/api/users").send(testUser);

            const loginRes = await agent.post("/api/sessions").send({ 
                email: testUser.email, 
                password: testUser.password 
            });

            expect(loginRes.status).toBe(201);
            expect(loginRes.body.email).toBe(testUser.email);
            expect(loginRes.body.name).toBe(testUser.name);
            expect(loginRes.body.phone).toBe(testUser.phone);
        });

        it("Should give back 401 for wrong credentials", async () => {
            const loginRes = await agent.post("/api/sessions").send({ 
                email: "nonesistente@email.com", 
                password: "password123" 
            });

            expect(loginRes.status).toBe(401);
        });
    });

    // ---- Get session ----
    describe("GET /api/sessions/current", () => {
        it("Should give back user's data if the session is valid", async () => {
            await agent.post("/api/users").send(testUser);

            const res = await agent.get("/api/sessions/current");

            expect(res.status).toBe(200);
            expect(res.body.email).toBe(testUser.email);
            expect(res.body.name).toBe(testUser.name);
            expect(res.body.phone).toBe(testUser.phone);
            expect(res.body).not.toHaveProperty('password');
        });

        it("Should give back 401 if the session is not valid", async () => {
            const res = await agent.get("/api/sessions/current");

            expect(res.status).toBe(401);
        });
    });

    // ---- Logout ----
    describe("DELETE /api/sessions/current", () => {
        it("Should give back 204 if the logout ended successfully", async () => {
            await agent.post("/api/users").send(testUser);
            
            const res = await agent.delete("/api/sessions/current");

            expect(res.status).toBe(204);
        });

        it("Should give 401 if there is no active session", async () => {
            const res = await agent.delete("/api/sessions/current");

            expect(res.status).toBe(401);
        });
    });


        // ---- Cambio password ----
    describe("PUT /api/users/password (Password change)", () => {
        // A hiker registered by an employee with a reservation: they get a temporary password
        async function hikerWithTemporaryPassword() {
            const employee = request.agent(BACKEND_URL);
            const employeeLogin = await employee.post("/api/sessions").send({
                email: "employee@mountainhut.test",
                password: "password",
            });
            expect(employeeLogin.status).toBe(201);

            const hiker = {
                name: "Giovanni Giorgio",
                email: `giovanni.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`,
                phone: "1234321",
            };
            // Slot 6 (in 8 days) of the demo data has free tables
            const booking = await employee.post("/api/reservations").send({ slotId: 6, partySize: 1, hiker });
            expect(booking.status).toBe(201);

            return { ...hiker, temporaryPassword: booking.body.temporaryPassword, reservationId: booking.body.reservationId };
        }

        it("Should give back 401 if there is no active session", async () => {
            const res = await agent.put("/api/users/password").send({ newPassword: "new-secret" });

            expect(res.status).toBe(401);
        });

        it("Should force the hiker to change the temporary password before using the site", async () => {
            const hiker = await hikerWithTemporaryPassword();

            // Login with the temporary password
            const loginRes = await agent.post("/api/sessions").send({ email: hiker.email, password: hiker.temporaryPassword });
            expect(loginRes.status).toBe(201);
            expect(loginRes.body.passwordToChange).toBe(true);

            // Everything else is blocked
            const blocked = await agent.get("/api/reservations");
            expect(blocked.status).toBe(403);
            expect(blocked.body.error).toBe("PASSWORD_CHANGE_REQUIRED");

            // Change the password
            const changeRes = await agent.put("/api/users/password").send({ newPassword: "new-secret" });
            expect(changeRes.status).toBe(200);
            expect(changeRes.body.email).toBe(hiker.email);
            expect(changeRes.body.passwordToChange).toBe(false);

            // Now the hiker can use the site and sees the reservation made by the employee
            const current = await agent.get("/api/sessions/current");
            expect(current.body.passwordToChange).toBe(false);
            const reservations = await agent.get("/api/reservations");
            expect(reservations.status).toBe(200);
            expect(reservations.body.map((r) => r.reservationId)).toEqual([hiker.reservationId]);
        });

        it("Should accept only the new password at the next login", async () => {
            const hiker = await hikerWithTemporaryPassword();
            await agent.post("/api/sessions").send({ email: hiker.email, password: hiker.temporaryPassword });
            await agent.put("/api/users/password").send({ newPassword: "new-secret" });

            const withTemporary = await request.agent(BACKEND_URL).post("/api/sessions").send({ email: hiker.email, password: hiker.temporaryPassword });
            const withNew = await request.agent(BACKEND_URL).post("/api/sessions").send({ email: hiker.email, password: "new-secret" });

            expect(withTemporary.status).toBe(401);
            expect(withNew.status).toBe(201);
            expect(withNew.body.passwordToChange).toBe(false);
        });

        it("Should give back 400 if the new password is shorter than 6 characters, and keep the hiker blocked", async () => {
            const hiker = await hikerWithTemporaryPassword();
            await agent.post("/api/sessions").send({ email: hiker.email, password: hiker.temporaryPassword });

            const res = await agent.put("/api/users/password").send({ newPassword: "12345" });

            expect(res.status).toBe(400);
            expect((await agent.get("/api/reservations")).status).toBe(403);
        });

        it("Should let the hiker log out without changing the password", async () => {
            const hiker = await hikerWithTemporaryPassword();
            await agent.post("/api/sessions").send({ email: hiker.email, password: hiker.temporaryPassword });

            const res = await agent.delete("/api/sessions/current");

            expect(res.status).toBe(204);
        });

        it("Should let a registered user change the password without being blocked before", async () => {
            const regRes = await agent.post("/api/users").send(testUser);
            expect(regRes.status).toBe(201);
            expect((await agent.get("/api/reservations")).status).toBe(200);

            const res = await agent.put("/api/users/password").send({ newPassword: "new-secret" });

            expect(res.status).toBe(200);
            expect(res.body.passwordToChange).toBe(false);
            const withNew = await request.agent(BACKEND_URL).post("/api/sessions").send({ email: testUser.email, password: "new-secret" });
            expect(withNew.status).toBe(201);
        });
    });
});