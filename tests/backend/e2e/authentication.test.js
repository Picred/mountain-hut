import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const BACKEND_URL = 'http://localhost:3001';

beforeAll(async () => {
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
});