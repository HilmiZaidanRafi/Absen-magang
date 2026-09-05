const serverless = require('serverless-http');
const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const ExcelJS = require('exceljs');
const path = require('path');

const app = express();
const db = new sqlite3.Database('./database.db');

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use(session({
    secret: 'absensi-secret-key-magang',
    resave: false,
    saveUninitialized: true
}));

// CONFIG LOKASI
const TARGET_LAT = -7.8016271;
const TARGET_LNG = 110.3803174;
const MAX_RADIUS = 10; // meter

// FLAG MODE PERCOBAAN (LOKASI BISA DI MANA SAJA)
const DEV_MODE = true;

// Inisialisasi Database
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        nama TEXT,
        role TEXT DEFAULT 'siswa'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS absensi (
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
    )`);

    // Inisialisasi Akun Default (Siswa & Dosen Pembimbing Sesuai Request)
    const defaultUsers = [
        { username: 'hilmizaidan', pass: '23.83.0971', nama: 'Hilmi Zaidan', role: 'siswa' },
        { username: 'andikahendra', pass: '23.83.0976', nama: 'Andika Hendra', role: 'siswa' },
        { username: 'wahidashori', pass: 'wahid2026', nama: 'Wahid Ashori, M.Kom (Dosen)', role: 'dosen' }
    ];

    defaultUsers.forEach(u => {
        const hash = bcrypt.hashSync(u.pass, 10);
        db.run(`INSERT OR IGNORE INTO users (username, password, nama, role) VALUES (?, ?, ?, ?)`, 
            [u.username, hash, u.nama, u.role]);
    });
});

// Formula Haversine
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

// Route Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) return res.status(400).json({ success: false, message: 'User tidak ditemukan' });
        if (bcrypt.compareSync(password, user.password)) {
            req.session.user = { id: user.id, username: user.username, nama: user.nama, role: user.role };
            res.json({ success: true, user: req.session.user });
        } else {
            res.status(400).json({ success: false, message: 'Password salah' });
        }
    });
});

app.get('/api/session', (req, res) => {
    if (req.session.user) res.json({ loggedIn: true, user: req.session.user });
    else res.json({ loggedIn: false });
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Route Absensi
app.post('/api/absen', (req, res) => {
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

    if (type === 'masuk') {
        let status = 'Tepat Waktu';
        if (timeStr > '07:00:59') status = 'Terlambat';

        db.get(`SELECT * FROM absensi WHERE user_id = ? AND tanggal = ?`, [req.session.user.id, dateStr], (err, row) => {
            if (row) return res.status(400).json({ message: 'Anda sudah absen masuk hari ini' });

            db.run(`INSERT INTO absensi (user_id, tanggal, jam_masuk, status_masuk, foto_masuk) VALUES (?, ?, ?, ?, ?)`,
                [req.session.user.id, dateStr, timeStr, status, image],
                (err) => {
                    if (err) return res.status(500).json({ message: 'Gagal mencatat absensi' });
                    res.json({ success: true, message: `Absen masuk berhasil (${status})` });
                }
            );
        });
    } else if (type === 'pulang') {
        let jamPulangAcuan = (day === 5) ? '14:00:00' : '15:30:00';
        let status = 'Sesuai Jadwal';
        if (timeStr < jamPulangAcuan) status = 'Pulang Awal';

        db.get(`SELECT * FROM absensi WHERE user_id = ? AND tanggal = ?`, [req.session.user.id, dateStr], (err, row) => {
            if (!row) return res.status(400).json({ message: 'Anda belum absen masuk hari ini' });
            if (row.jam_pulang) return res.status(400).json({ message: 'Anda sudah absen pulang hari ini' });

            db.run(`UPDATE absensi SET jam_pulang = ?, status_pulang = ?, foto_pulang = ? WHERE id = ?`,
                [timeStr, status, image, row.id],
                (err) => {
                    if (err) return res.status(500).json({ message: 'Gagal mencatat absensi pulang' });
                    res.json({ success: true, message: `Absen pulang berhasil (${status})` });
                }
            );
        });
    }
});

// API DOSEN
app.get('/api/dosen/monitoring', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'dosen') {
        return res.status(403).json({ message: 'Akses khusus Dosen' });
    }

    const query = `
        SELECT a.*, u.nama, u.username 
        FROM absensi a 
        JOIN users u ON a.user_id = u.id 
        ORDER BY a.tanggal DESC, a.jam_masuk DESC
    `;

    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ message: 'Database error' });
        
        const stats = {
            totalAbsen: rows.length,
            terlambat: rows.filter(r => r.status_masuk === 'Terlambat').length,
            pulangAwal: rows.filter(r => r.status_pulang === 'Pulang Awal').length
        };

        res.json({ stats, data: rows });
    });
});

// Export Laporan Excel
app.get('/api/export', async (req, res) => {
    if (!req.session.user) return res.status(401).send('Unauthorized');
    const { range } = req.query; 
    
    let daysBack = range === 'weekly' ? 7 : 30;
    const dateLimit = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let query = `SELECT a.*, u.nama, u.username FROM absensi a JOIN users u ON a.user_id = u.id WHERE a.tanggal >= ?`;
    let params = [dateLimit];

    if (req.session.user.role === 'siswa') {
        query += ` AND a.user_id = ?`;
        params.push(req.session.user.id);
    }

    query += ` ORDER BY a.tanggal DESC`;

    db.all(query, params, async (err, rows) => {
        if (err) return res.status(500).send('Error database');

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

        rows.forEach(r => sheet.addRow(r));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Laporan_Absensi_${range}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    });
});

app.listen(3000, () => console.log('Server running di http://localhost:3000'));
// Export app agar bisa dibaca oleh Vercel
module.exports = app;

// Hanya jalankan app.listen() jika dijalankan secara lokal di laptop
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}