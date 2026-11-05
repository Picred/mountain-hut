import { dbAll } from '../../utils/dbHelpers.js';

// Registered hikers whose name, email or phone contains the text (case insensitive).
export const searchHikers = (text) => dbAll(`
    SELECT user_id AS userId, name, email, phone
    FROM users
    WHERE role = 'hiker'
        AND (instr(lower(name), lower(?1)) > 0
            OR instr(lower(email), lower(?1)) > 0
            OR instr(COALESCE(phone, ''), ?1) > 0)
    ORDER BY name, user_id
`, [text]);
