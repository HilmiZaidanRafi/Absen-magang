const { createClient } = require('@libsql/client/http'); // Gunakan adapter HTTP khusus

const url = (process.env.TURSO_DATABASE_URL || '').trim();
const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim();

// Pakai protokol https:// agar cocok dengan adapter /http
const formattedUrl = url.replace('libsql://', 'https://');

const db = createClient({
    url: formattedUrl,
    authToken: authToken
});

module.exports = db;