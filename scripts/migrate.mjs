import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not available. The application can still run in demo repository mode; configure the managed database before running migrations.');
  process.exit(1);
}

const migrationDir = new URL('../db/migrations/', import.meta.url);
const files = (await fs.readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
const connection = await mysql.createConnection(process.env.DATABASE_URL);
try {
  for (const file of files) {
    const sql = await fs.readFile(new URL(file, migrationDir), 'utf8');
    for (const statement of sql.split(/;\s*(?:\n|$)/).map((value) => value.trim()).filter(Boolean)) await connection.query(statement);
  }
  console.log('BKM managed database migration complete.');
} finally {
  await connection.end();
}
