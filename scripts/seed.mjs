import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not available. Configure the managed database before running the seed.');
  process.exit(1);
}

const seedDir = new URL('../db/seed/', import.meta.url);
const files = (await fs.readdir(seedDir)).filter((file) => file.endsWith('.sql')).sort();
const connection = await mysql.createConnection(process.env.DATABASE_URL);
try {
  for (const file of files) {
    const sql = await fs.readFile(new URL(file, seedDir), 'utf8');
    for (const statement of sql.split(/;\s*(?:\n|$)/).map((value) => value.trim()).filter(Boolean)) await connection.query(statement);
  }
  console.log('BKM fictional demonstration seed complete.');
} finally {
  await connection.end();
}
