import { Router } from 'express';
import passport from "passport";
import LocalStrategy from "passport-local";
import ensureAuthenticated from '../middlewares/auth-middleware.js';
import BadRequestError from '../models/errors/BadRequestError.js';
import ConflictError from '../models/errors/ConflictError.js';
import UnauthorizedError from '../models/errors/UnauthorizedError.js';
import crypto from 'node:crypto';
import { sendPasswordRecovery } from '../services/passwordRecovery.js';
import { getUser, createUser, changePassword, getHikerByEmail, saveResetToken, getUserByResetToken } from '../models/dao/authenticationDAO.js';

const router = Router();

// Configurazione LocalStrategy usando 'email' al posto di 'username'
passport.use(new LocalStrategy(
    { usernameField: 'email' },
    async function verify(email, password, callback) {
        try {
            const user = await getUser(email, password);
            if (!user) {
                return callback(null, false, { message: "Invalid email or password." });
            }
            return callback(null, user);
        } catch (err) {
            return callback(err);
        }
    }
));

passport.serializeUser((user, callback) => callback(null, user));
passport.deserializeUser((user, callback) => callback(null, user));


// 1. POST /api/users --> Registrazione (tutti i campi obbligatori)
router.post("/api/users", async (req, res, next) => {
    try {
        const { name, email, phone, password } = req.body;

        if (!name || !email || !phone || !password) {
            return next(new BadRequestError("All fields (name, email, phone, password) are required."));
        }

        if (password.length < 6) {
            return next(new BadRequestError("The password must contain at least 6 characters."));
        }

        const result = await createUser(name, email, phone, password);

        if (result.isDuplicate) {
            return next(new ConflictError("Email already in use"));
        }

        const newUser = {
            user_id: result.user_id,
            name: result.name,
            email: result.email,
            phone: result.phone,
            role: result.role
        };

        req.login(newUser, (err) => {
            if (err) return next(err);
            return res.status(201).json(newUser);
        });

    } catch (err) {
        next(err);
    }
});


// 2. POST /api/sessions --> Login (richiede "email" e "password" nel body)
router.post("/api/sessions", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
        if (err) return next(err);

        if (!user) {
            return next(new UnauthorizedError(info?.message || "Invalid credentials."));
        }

        req.login(user, (err) => {
            if (err) return next(err);
            return res.status(201).json(req.user);
        });

    })(req, res, next);
});


// 3. GET /api/sessions/current --> Sessione corrente
router.get("/api/sessions/current", ensureAuthenticated, (req, res) => {
    return res.json(req.user);
});


// 4. DELETE /api/sessions/current --> Logout
router.delete("/api/sessions/current", ensureAuthenticated, (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        return res.status(204).end();
    });
});

// 5. PUT /api/users/password --> Password change of the logged user
router.put("/api/users/password", ensureAuthenticated, async (req, res, next) => {
    const { newPassword } = req.body ?? {};

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return next(new BadRequestError("The password must contain at least 6 characters."));
    }

    const updated = await changePassword(req.user.user_id, newPassword);
    if (!updated) {
        return next(new UnauthorizedError("UNAUTHORIZED"));
    }

    const user = { ...req.user, passwordToChange: false };
    req.login(user, (err) => {
        if (err) return next(err);
        return res.status(200).json(user);
    });
});

// Reset links are valid for 24 hours (see NIST SP 800-63A-4, sec. 3.8)
const RESET_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173';

// Only the hash of the token is saved: the token itself is only in the email
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// 6. POST /api/users/password-reset --> Sends a link to choose a new password by email
router.post("/api/users/password-reset", async (req, res, next) => {
    const { email } = req.body ?? {};

    if (typeof email !== 'string' || email.trim().length === 0) {
        return next(new BadRequestError("INVALID_INPUT"));
    }

    const hiker = await getHikerByEmail(email.trim());

    if (hiker) {
        // The current password keeps working until the link is used
        const token = crypto.randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
        await saveResetToken(hiker.user_id, hashToken(token), expiresAt);

        const link = `${FRONTEND_URL}/reset-password?token=${token}`;
        await sendPasswordRecovery(hiker.email, hiker.name, link);
    }

    // Always the same answer, so it does not tell whether the email is registered
    return res.status(204).end();
});

// 7. POST /api/users/password-reset/confirm --> Sets the new password with the token of the link
router.post("/api/users/password-reset/confirm", async (req, res, next) => {
    const { token, newPassword } = req.body ?? {};

    if (typeof token !== 'string' || token.length === 0) {
        return next(new BadRequestError("INVALID_INPUT"));
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return next(new BadRequestError("The password must contain at least 6 characters."));
    }

    const user = await getUserByResetToken(hashToken(token));
    if (!user) {
        return next(new BadRequestError("INVALID_OR_EXPIRED_TOKEN"));
    }

    // Saves the new password and invalidates the token: the link works only once
    await changePassword(user.user_id, newPassword);

    return res.status(204).end();
});

export default router;