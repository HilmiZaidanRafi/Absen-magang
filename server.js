const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const ExcelJS = require('exceljs');
const path = require('path');
const db = require('./db');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'absensi-secret-key-magang',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set true jika menggunakan HTTPS penuh
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// CONFIG LOKASI
const TARGET_LAT = -7.8016271;
const TARGET_LNG = 110.3803174;
const MAX_RADIUS = 10;
const DEV_MODE = true;

// Inisialisasi Tabel & Seed Data Satu per Satu (Menghindari Status 400 Turso)
async function initDb() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT,
                nama TEXT,
                role TEXT DEFAULT 'siswa'
            )
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
                foto_pulang TEXT
            )
        `);

        const defaultUsers = [
            { username: 'hilmizaidan', pass: '23.83.0971', nama: 'Hilmi Zaidan', role: 'siswa' },
            { username: 'andikahendra', pass: '23.83.0976', nama: 'Andika Hendra', role: 'siswa' },
            { username: 'wahidashori', pass: 'wahid2026', nama: 'Wahid Ashori, M.Kom (Dosen)', role: 'dosen' }
        ];

        for (const u of defaultUsers) {
            const check = await db.execute({
                sql: 'SELECT id FROM users WHERE username = ?',
                args: [u.username]
            });

            if (check.rows.length === 0) {
                const hash = bcrypt.hashSync(u.pass, 10);
                await db.execute({
                    sql: 'INSERT INTO users (username, password, nama, role) VALUES (?, ?, ?, ?)',
                    args: [u.username, hash, u.nama, u.role]
                });
            }
        }
    } catch (err) {
        console.error("Gagal Inisialisasi Turso DB:", err);
    }
}

// Jalankan Inisialisasi DB
initDb();

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ROUTE API
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await db.execute({
            sql: 'SELECT * FROM users WHERE username = ?',
            args: [username]
        });

        const user = result.rows[0];
        if (!user) {
            return res.status(400).json({ success: false, message: 'User tidak ditemukan' });
        }

        if (bcrypt.compareSync(password, user.password)) {
            req.session.user = { id: user.id, username: user.username, nama: user.nama, role: user.role };
            return res.json({ success: true, user: req.session.user });
        } else {
            return res.status(400).json({ success: false, message: 'Password salah' });
        }
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get('/api/session', (req, res) => {
    if (req.session && req.session.user) {
        return res.json({ loggedIn: true, user: req.session.user });
    }
    return res.json({ loggedIn: false });
});

app.get('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

app.post('/api/absen', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'siswa') {
        return res.status(401).json({ message: 'Akses ditolak' });
    }
    
    const { lat, lng, image, type } = req.body;
    const distance = getDistance(lat, lng, TARGET_LAT, TARGET_LNG);

    if (!DEV_MODE && distance > MAX_RADIUS) {
        return res.status(400).json({ 
            message: `ANDA TIDAK BERADA DI RADIUS AMAN UNTUK ABSEN (Jarak: ${distance.toFixed(1)}m)` 
        });
    }

    const now = new Date();
    const day = now.getDay(); 
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];

    if (day === 0 || day === 6) {
        return res.status(400).json({ message: 'Hari ini libur/bukan hari kerja' });
    }

    try {
        if (type === 'masuk') {
            let status = timeStr > '07:00:59' ? 'Terlambat' : 'Tepat Waktu';

            const check = await db.execute({
                sql: 'SELECT id FROM absensi WHERE user_id = ? AND tanggal = ?',
                args: [req.session.user.id, dateStr]
            });

            if (check.rows.length > 0) {
                return res.status(400).json({ message: 'Anda sudah absen masuk hari ini' });
            }

            await db.execute({
                sql: 'INSERT INTO absensi (user_id, tanggal, jam_masuk, status_masuk, foto_masuk) VALUES (?, ?, ?, ?, ?)',
                args: [req.session.user.id, dateStr, timeStr, status, image]
            });

            return res.json({ success: true, message: `Absen masuk berhasil (${status})` });

        } else if (type === 'pulang') {
            let jamPulangAcuan = (day === 5) ? '14:00:00' : '15:30:00';
            let status = timeStr < jamPulangAcuan ? 'Pulang Awal' : 'Sesuai Jadwal';

            const check = await db.execute({
                sql: 'SELECT * FROM absensi WHERE user_id = ? AND tanggal = ?',
                args: [req.session.user.id, dateStr]
            });

            const row = check.rows[0];
            if (!row) return res.status(400).json({ message: 'Anda belum absen masuk hari ini' });
            if (row.jam_pulang) return res.status(400).json({ message: 'Anda sudah absen pulang hari ini' });

            await db.execute({
                sql: 'UPDATE absensi SET jam_pulang = ?, status_pulang = ?, foto_pulang = ? WHERE id = ?',
                args: [timeStr, status, image, row.id]
            });

            return res.json({ success: true, message: `Absen pulang berhasil (${status})` });
        }
    } catch (err) {
        return res.status(500).json({ message: 'Gagal mencatat absensi' });
    }
});

app.get('/api/dosen/monitoring', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'dosen') {
        return res.status(403).json({ message: 'Akses khusus Dosen' });
    }

    try {
        const result = await db.execute(`
            SELECT a.*, u.nama, u.username 
            FROM absensi a 
            JOIN users u ON a.user_id = u.id 
            ORDER BY a.tanggal DESC, a.jam_masuk DESC
        `);

        const rows = result.rows;
        const stats = {
            totalAbsen: rows.length,
            terlambat: rows.filter(r => r.status_masuk === 'Terlambat').length,
            pulangAwal: rows.filter(r => r.status_pulang === 'Pulang Awal').length
        };

        return res.json({ stats, data: rows });
    } catch (err) {
        return res.status(500).json({ message: 'Database error' });
    }
});

app.get('/api/export', async (req, res) => {
    if (!req.session.user) return res.status(401).send('Unauthorized');
    const { range } = req.query; 
    
    let daysBack = range === 'weekly' ? 7 : 30;
    const dateLimit = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let query = 'SELECT a.*, u.nama, u.username FROM absensi a JOIN users u ON a.user_id = u.id WHERE a.tanggal >= ?';
    let params = [dateLimit];

    if (req.session.user.role === 'siswa') {
        query += ' AND a.user_id = ?';
        params.push(req.session.user.id);
    }

    query += ' ORDER BY a.tanggal DESC';

    try {
        const result = await db.execute({ sql: query, args: params });
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Laporan Absensi');

        sheet.columns = [
            { header: 'Tanggal', key: 'tanggal', width: 15 },
            { header: 'Username', key: 'username', width: 15 },
            { header: 'Nama Lengkap', key: 'nama', width: 25 },
            { header: 'Jam Masuk', key: 'jam_masuk', width: 12 },
            { header: 'Status Masuk', key: 'status_masuk', width: 15 },
            { header: 'Jam Pulang', key: 'jam_pulang', width: 12 },
            { header: 'Status Pulang', key: 'status_pulang', width: 15 }
        ];

        result.rows.forEach(r => sheet.addRow(r));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Laporan_Absensi_${range}.xlsx`);
        await workbook.xlsx.write(res);
        return res.end();
    } catch (err) {
        return res.status(500).send('Error database');
    }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}