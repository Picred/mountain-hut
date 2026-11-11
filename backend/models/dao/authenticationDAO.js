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
                phone: row.phone,
                passwordToChange: row.password_to_change === 1
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


// Hashes a password with a new random salt, in the format checked by getUser
export const hashPassword = (password) => {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16).toString('hex');

        crypto.scrypt(password, salt, 32, (err, hashedPassword) => {
            if (err) return reject(err);
            resolve({ salt, passwordHash: hashedPassword.toString('hex') });
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


export const changePassword = (user_id, newPassword, passwordToChange = 0) => {
    return new Promise((resolve, reject)=> {
        const salt = crypto.randomBytes(16).toString('hex');

        crypto.scrypt(newPassword, salt, 32, (err, hashedPassword) => {
            if (err) return reject(err);

            const sql = `
                UPDATE users
                SET salt = ?, password_hash = ?, password_to_change = ?
                WHERE user_id = ?
            `;

            const passwordHashHex = hashedPassword.toString('hex');

            db.run(sql, [salt, passwordHashHex, passwordToChange, user_id], function (err) {
                if (err) return reject(err);
                resolve(this.changes === 1);
            });
        });
        
    })
}

export const getHikerByEmail = (email) => {
    return new Promise((resolve,reject) => {
        const sql = `
        SELECT user_id, name, email, role
        FROM users
        WHERE email = ? AND role = 'hiker'
        `

        db.get(sql, [email], (err,row) => {
            if(err) return reject(err);
            if(!row) return resolve(null);
            return resolve({
                user_id: row.user_id,
                name: row.name,
                email: row.email,
                role: row.role,
            })
            
        })
    })
}