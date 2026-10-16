# Gaji Harian Pondok

Aplikasi absen dan gaji harian pondok. Kak Umar mengisi absen, pemilik melihat nominal dan menandai lunas.

## Peran

| Peran | Login dengan | Bisa apa |
|---|---|---|
| Kak Umar (admin) | `ADMIN_PIN` | Absen harian, lembur, kasbon, ubah nama & upah, tandai lunas |
| Pemilik pondok | `OWNER_PIN` | Lihat menu Gaji (nominal, rekap, teks WhatsApp), tandai lunas |

## Deploy ke Railway

1. Upload folder ini ke repo GitHub baru (misalnya `gaji-pondok`).
2. Di Railway: **New Project → Deploy from GitHub repo** → pilih repo tersebut.
3. Di project yang sama: **+ New → Database → Add PostgreSQL**.
4. Buka service aplikasi → **Variables**, lalu isi:

   | Variable | Isi |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (pilih dari referensi variabel) |
   | `ADMIN_PIN` | PIN untuk Kak Umar, misalnya 6 angka |
   | `OWNER_PIN` | PIN untuk pemilik, harus berbeda dari PIN admin |
   | `SESSION_SECRET` | Teks acak panjang (minimal 32 karakter) |
   | `ADMIN_NAME` | `Kak Umar` (opsional) |
   | `OWNER_NAME` | `Pemilik` atau nama pemilik (opsional) |

5. **Settings → Networking → Generate Domain**. Hasilnya misalnya `gaji-pondok.up.railway.app`.
6. Buka alamat itu, lalu masuk dengan PIN.

Tabel database dibuat otomatis saat pertama kali jalan. Empat nama awal (Mas Ipin, Pak De Alung, Ijal, Pak Sugeng) langsung muncul dan bisa diubah di menu **Nama**.

Alternatif tanpa GitHub: install Railway CLI, lalu `railway login`, `railway init`, `railway up` dari folder ini. Langkah 3–5 tetap sama.

## Pasang di HP

Buka alamatnya di Chrome (Android) atau Safari (iPhone), lalu pilih **Tambahkan ke Layar Utama**. Aplikasi akan muncul seperti app biasa.

## Jalankan di komputer

```
npm install
ADMIN_PIN=1111 OWNER_PIN=2222 npm start
```

Tanpa `DATABASE_URL`, data disimpan di `data.json`.
