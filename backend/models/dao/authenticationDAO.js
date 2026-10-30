import crypto from "crypto";
import db from '../../db/db.js'; 

// Look for user for login
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

            const user = { 
                user_id: row.user_id, 
                name: row.name,
                email: row.email, 
                role: row.role,
                phone: row.phone
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