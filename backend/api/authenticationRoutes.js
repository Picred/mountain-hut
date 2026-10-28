import { Router } from 'express';
import passport from "passport";
import LocalStrategy from "passport-local";
import { getUser, createUser } from '../models/dao/authenticationDAO.js';
import ensureAuthenticated from '../middlewares/auth-middleware.js';
import BadRequestError from '../models/errors/BadRequestError.js';
import ConflictError from '../models/errors/ConflictError.js';
import UnauthorizedError from '../models/errors/UnauthorizedError.js';

const router = Router();

// Configurazione LocalStrategy usando 'email' al posto di 'username'
passport.use(new LocalStrategy(
    { usernameField: 'email' },
    async function verify(email, password, callback) {
        try {
            const user = await getUser(email, password);
            if (!user) {
                return callback(null, false, { message: "Email o password non valide." });
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
            return next(new BadRequestError("Tutti i campi (name, email, phone, password) sono obbligatori"));
        }

        if (password.length < 6) {
            return next(new BadRequestError("La password deve contenere almeno 6 caratteri"));
        }

        const result = await createUser(name, email, phone, password);

        if (result.isDuplicate) {
            return next(new ConflictError("Email già in uso")); 
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
            return next(new UnauthorizedError(info?.message || "Credenziali non valide"));
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

export default router;