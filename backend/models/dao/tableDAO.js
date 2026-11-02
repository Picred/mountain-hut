import { dbAll, dbRun } from '../../utils/dbHelpers.js';
import ConflictError from '../errors/ConflictError.js';

// table types (code+seats)
export const listTables = async () => {
    const rows = await dbAll(`
        SELECT table_id, table_code, seats
        FROM tables
        ORDER BY table_code, seats
    `);

    return rows.map(row => ({
        tableId: row.table_id,
        code: row.table_code,
        seats: row.seats
    }));
};

// adds a new table type to the catalog, code not unique, code+seats unique

export const createTable = async (code, seats) => {
    try {
        const result = await dbRun(
            'INSERT INTO tables (table_code, seats) VALUES (?, ?)',
            [code, seats]
        );
        return { tableId: result.lastID, code, seats };
    } catch (err) {
        if (err.message?.includes('UNIQUE constraint failed')) {
            throw new ConflictError('TABLE_ALREADY_EXISTS');
        }
        throw err;
    }
};