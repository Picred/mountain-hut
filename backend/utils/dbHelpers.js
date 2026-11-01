import db from '../db/db.js';

/**
 * Executes a query that returns multiple rows.
 */
export const dbAll = (sql, params = [], connection = db) => {
    return new Promise((resolve, reject) => {
        connection.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
};

/**
 * Executes a query that returns a single row.
 */
export const dbGet = (sql, params = [], connection = db) => {
    return new Promise((resolve, reject) => {
        connection.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
};

/**
 * Executes a query that modifies the database.
 */
export const dbRun = (sql, params = [], connection = db) => {
    return new Promise((resolve, reject) => {
        connection.run(sql, params, function (err) {
            if (err) return reject(err);

            resolve({
                lastID: this.lastID,
                changes: this.changes
            });
        });
    });
};
