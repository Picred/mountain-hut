import sqlite from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, 'db.sqlite');

const db = new sqlite.Database(DB_PATH, sqlite.OPEN_READWRITE, (err) => {
  if (err) throw err;
});

db.run('PRAGMA foreign_keys = ON');

export default db;

//to have the db: npm run db:init