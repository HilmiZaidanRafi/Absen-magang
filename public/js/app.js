let video = document.getElementById('video');
let canvas = document.getElementById('canvas');
let mapInstance = null;
let markerInstance = null;

// =========================================================================
// KOORDINAT AKURAT KESBANGPOL KOTA YOGYAKARTA (Sesuai Link Google Maps)
// Jl. Sultan Agung No.133, Gunungketur, Pakualaman, Kota Yogyakarta
// =========================================================================
const KESBANGPOL_LAT = -7.8016271; 
const KESBANGPOL_LNG = 110.3803174; 
const MAX_RADIUS_METERS = 10; // Radius maksimal 10 meter

// Fungsi Menghitung Jarak Antara 2 Titik Koordinat (Dalam Meter)
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Jari-jari bumi dalam meter
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// Cek Sesi Otomatis
fetch('/api/session')
    .then(res => res.json())
    .then(data => {
        if (data.loggedIn) {
            renderDashboard(data.user);
        } else {
            showLogin();
        }
    })
    .catch(err => showLogin());

// Handle Event Login Form
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: document.getElementById('username').value,
                password: document.getElementById('password').value
            })
        });
        const data = await res.json();
        if (data.success) {
            renderDashboard(data.user);
        } else {
            alert(data.message);
        }
    } catch (err) {
        alert("Gagal terhubung ke server.");
    }
});

function showLogin() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('siswa-section').classList.add('hidden');
    document.getElementById('dosen-section').classList.add('hidden');
}

function renderDashboard(user) {
    document.getElementById('login-section').classList.add('hidden');

    if (user.role === 'siswa') {
        // 1. Tampilkan section siswa terlebih dahulu
        document.getElementById('siswa-section').classList.remove('hidden');
        document.getElementById('dosen-section').classList.add('hidden');
        document.getElementById('siswa-nama').innerText = user.nama;
        
        // 2. Beri jeda sedikit agar DOM dirender sepenuhnya baru nyalakan kamera & dapatkan posisi GPS awal
        setTimeout(() => {
            initCamera();
            initMapUserLocation();
        }, 300);

    } else if (user.role === 'dosen') {
        document.getElementById('dosen-section').classList.remove('hidden');
        document.getElementById('siswa-section').classList.add('hidden');
        document.getElementById('dosen-nama').innerText = user.nama;
        loadDosenData();
    }
}

function initCamera() {
    video = document.getElementById('video'); // Memastikan elemen terhubung
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Browser tidak mendukung akses kamera atau koneksi tidak menggunakan HTTPS/Localhost.");
        return;
    }

    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: "user", // Menggunakan kamera depan
            width: { ideal: 640 },
            height: { ideal: 480 }
        },
        audio: false
    })
    .then(stream => {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play().catch(e => console.error("Error auto-play video:", e));
        };
    })
    .catch(err => {
        console.error("Akses kamera ditolak/gagal:", err);
        alert("Gagal memuat kamera. Pastikan tidak ada aplikasi lain (Zoom/GMeet/Kamera HP) yang sedang menggunakan kamera.");
    });
}

// Inisialisasi peta dengan mendeteksi posisi asli pengguna saat membuka dashboard
function initMapUserLocation() {
    const mapDiv = document.getElementById('map');
    if (mapDiv) mapDiv.style.display = 'block';

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            const userLat = pos.coords.latitude;
            const userLng = pos.coords.longitude;
            updateMapPosition(userLat, userLng, "Posisi Anda Saat Ini");
        }, () => {
            // Default fallback ke Kesbangpol jika GPS tidak diizinkan saat awal load
            updateMapPosition(KESBANGPOL_LAT, KESBANGPOL_LNG, "Kesbangpol Kota Yogyakarta");
        }, { enableHighAccuracy: true });
    } else {
        updateMapPosition(KESBANGPOL_LAT, KESBANGPOL_LNG, "Kesbangpol Kota Yogyakarta");
    }
}

// Fungsi pembantu untuk membuat atau memperbarui marker di peta
function updateMapPosition(lat, lng, labelText) {
    if (!mapInstance) {
        mapInstance = L.map('map').setView([lat, lng], 17);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(mapInstance);

        markerInstance = L.marker([lat, lng]).addTo(mapInstance)
            .bindPopup(`<b>${labelText}</b><br>Lat: ${lat.toFixed(5)}<br>Lng: ${lng.toFixed(5)}`)
            .openPopup();
    } else {
        mapInstance.setView([lat, lng], 17);
        markerInstance.setLatLng([lat, lng])
            .setPopupContent(`<b>${labelText}</b><br>Lat: ${lat.toFixed(5)}<br>Lng: ${lng.toFixed(5)}`)
            .openPopup();
    }
    setTimeout(() => { mapInstance.invalidateSize(); }, 300);
}

async function submitAbsen(type) {
    const statusBox = document.getElementById('status-msg');
    statusBox.style.display = 'block';
    statusBox.style.background = 'rgba(56, 189, 248, 0.15)';
    statusBox.style.color = 'var(--accent-blue)';
    statusBox.innerText = "Mendapatkan lokasi GPS Anda...";

    // Pastikan video/kamera aktif saat tombol absen ditekan
    if (!video.srcObject || video.paused || video.ended) {
        initCamera();
    }

    if (!navigator.geolocation) return alert("Browser tidak mendukung geolokasi GPS");

    navigator.geolocation.getCurrentPosition(async (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;

        // 1. Tampilkan titik asli posisi pengguna di peta (di manapun berada)
        updateMapPosition(latitude, longitude, "Lokasi Terdeteksi");

        // 2. Hitung Jarak ke Lokasi Kesbangpol Kota Yogyakarta
        const distance = getDistanceInMeters(latitude, longitude, KESBANGPOL_LAT, KESBANGPOL_LNG);

        // 3. Validasi Radius 10 Meter
        if (distance > MAX_RADIUS_METERS) {
            statusBox.style.background = 'rgba(248, 113, 113, 0.15)';
            statusBox.style.color = 'var(--accent-red)';
            statusBox.innerText = `Gagal Absen: Anda berada di luar area Kesbangpol (Jarak Anda: ${distance.toFixed(1)}m, Maksimal: ${MAX_RADIUS_METERS}m).`;
            return;
        }

        // 4. Ambil Snapshot Gambar dari Video Canvas
        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        
        if (canvas.width === 0 || canvas.height === 0) {
            alert("Kamera belum siap, silakan tunggu beberapa detik dan coba lagi.");
            return;
        }

        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL('image/jpeg');

        statusBox.innerText = "Mengirim data presensi...";

        try {
            const res = await fetch('/api/absen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat: latitude, lng: longitude, image, type })
            });

            const data = await res.json();
            
            statusBox.innerText = data.message;
            if (res.ok) {
                statusBox.style.background = 'rgba(52, 211, 153, 0.15)';
                statusBox.style.color = 'var(--accent-green)';

                // Tampilkan Info Hari, Jam & Titik Peta Berhasil
                displayAbsenInfoAndMap(latitude, longitude, type);
            } else {
                statusBox.style.background = 'rgba(248, 113, 113, 0.15)';
                statusBox.style.color = 'var(--accent-red)';
            }
        } catch (err) {
            statusBox.style.background = 'rgba(248, 113, 113, 0.15)';
            statusBox.style.color = 'var(--accent-red)';
            statusBox.innerText = "Gagal terhubung ke server saat mengirim presensi.";
        }

    }, (err) => {
        statusBox.style.background = 'rgba(248, 113, 113, 0.15)';
        statusBox.style.color = 'var(--accent-red)';
        statusBox.innerText = "Gagal mengambil lokasi. Izinkan akses GPS pada HP/Browser Anda.";
    }, { 
        enableHighAccuracy: true,
        timeout: 10000, 
        maximumAge: 0 
    });
}

function displayAbsenInfoAndMap(lat, lng, type) {
    const now = new Date();
    
    // Format Hari & Tanggal dalam bahasa Indonesia
    const opsiHari = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const hariTanggal = now.toLocaleDateString('id-ID', opsiHari);
    const jamSekarang = now.toTimeString().split(' ')[0];

    document.getElementById('info-absen-box').classList.remove('hidden');
    document.getElementById('info-hari-tanggal').innerText = hariTanggal;

    if (type === 'masuk') {
        document.getElementById('info-jam-masuk').innerText = jamSekarang;
    } else if (type === 'pulang') {
        document.getElementById('info-jam-pulang').innerText = jamSekarang;
    }

    // Perbarui Tampilan Peta
    updateMapPosition(lat, lng, "Lokasi Presensi Berhasil");
}

async function loadDosenData() {
    try {
        const res = await fetch('/api/dosen/monitoring');
        if (!res.ok) return;

        const { stats, data } = await res.json();

        document.getElementById('stat-total').innerText = stats.totalAbsen;
        document.getElementById('stat-terlambat').innerText = stats.terlambat;
        document.getElementById('stat-pulang-awal').innerText = stats.pulangAwal;

        const tbody = document.getElementById('dosen-table-body');
        tbody.innerHTML = '';

        if(data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-sub);">Belum ada data presensi siswa</td></tr>`;
            return;
        }

        data.forEach(r => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${r.tanggal}</td>
                <td><b>${r.nama}</b><br><small style="color:var(--text-sub)">@${r.username}</small></td>
                <td>${r.jam_masuk || '-'}</td>
                <td><span class="badge ${r.status_masuk === 'Terlambat' ? 'badge-danger' : 'badge-success'}">${r.status_masuk || '-'}</span></td>
                <td>${r.jam_pulang || '-'}</td>
                <td><span class="badge ${r.status_pulang === 'Pulang Awal' ? 'badge-warning' : 'badge-success'}">${r.status_pulang || '-'}</span></td>
            `;
            tbody.appendChild(row);
        });
    } catch (e) {
        console.error("Error load data dosen:", e);
    }
}

async function logout() {
    await fetch('/api/logout');
    location.reload();
}