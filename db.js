const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:database.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      nama TEXT,
      role TEXT DEFAULT 'siswa'
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS absensi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      tanggal TEXT,
      jam_masuk TEXT,
      jam_pulang TEXT,
      status_masuk TEXT,
      status_pulang TEXT,
      foto_masuk TEXT,
      foto_pulang TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
}

initDb().catch(console.error);

module.exports = db;