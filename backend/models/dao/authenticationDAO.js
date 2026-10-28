import crypto from "crypto";
import db from '../../db/db.js'; 

// Cerca utente per il login
export const getUser = (email, password) => {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT *
            FROM USERS
            WHERE email = ?
        `;

        db.get(sql, [email], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(false);

            // Mappiamo row.uId / row.user_id su user_id come richiesto dagli altri endpoint
            const user = { 
                user_id: row.uId ?? row.user_id, 
                email: row.email, 
                role: row.role, 
                cId: row.cId 
            };

            crypto.scrypt(password, row.salt, 32, (err, hashedPassword) => {
                if (err) return reject(err);

                const dbPasswordHash = Buffer.from(row.password_hash, "hex");

                if (dbPasswordHash.length !== hashedPassword.length || 
                    !crypto.timingSafeEqual(dbPasswordHash, hashedPassword)) {
                    return resolve(false);
                }

                resolve(user);
            });
        });
    });
};


// Crea un nuovo utente nel database
export const createUser = (name, email, phone, password, role = 'hiker') => {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16).toString('hex');

        crypto.scrypt(password, salt, 32, (err, hashedPassword) => {
            if (err) return reject(err);

            const sql = `
                INSERT INTO USERS (name, email, phone, password_hash, salt, role)
                VALUES (?, ?, ?, ?, ?, ?)
            `;
            const passwordHashHex = hashedPassword.toString('hex');

            db.run(sql, [name, email, phone, passwordHashHex, salt, role], function (err) {
                if (err) {
                    if (err.message && err.message.includes('UNIQUE constraint failed')) {
                        return resolve({ isDuplicate: true });
                    }
                    return reject(err);
                }

                // this.lastID restituisce l'user_id generato da SQLite
                return resolve({ 
                    user_id: this.lastID, 
                    name,
                    email,
                    phone,
                    role 
                });
            });
        });
    });
};