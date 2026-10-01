# SMKWD E-Absensi — Direct Firebase Realtime Database

## 1. Hasil perubahan

### Sebelum
`Frontend / GitHub Pages → GAS → Firebase RTDB`

### Sesudah
`Frontend / GitHub Pages → Firebase Authentication → Firebase Realtime Database`

GAS **tidak dipanggil oleh aplikasi harian**. `firebase-direct.js` menyediakan lapisan kompatibilitas lokal agar kode UI lama yang masih menulis `google.script.run...` tetap dapat berjalan. Itu bukan Google Apps Script: tidak ada `fetch()` ke URL GAS pada runtime aplikasi.

GAS hanya disimpan di `private_migration/` untuk:
- import seed awal,
- membuat akun Firebase Authentication,
- provisioning akun siswa/guru/piket,
- Admin Mirror Google Sheets bila masih dibutuhkan.

Firebase Security Rules tetap menjadi pengaman sebenarnya; client tidak boleh dipercaya untuk menentukan role. Firebase sendiri menerapkan Rules pada setiap request. 

## 2. Isi paket

### File yang dipasang ke GitHub Pages
- `index.html` — aplikasi Absensi Siswa yang sudah diarahkan ke Firebase.
- `firebase-config.js` — konfigurasi Web App Firebase milik sekolah.
- `firebase-direct.js` — operasi Auth/Realtime Database langsung dari browser.
- `firebase.rules.json` — Security Rules.
- `firebase.schema.example.json` — contoh struktur pohon.
- `firebase_tree_admin.html` — editor pohon JSON untuk admin.
- `README_DIRECT_FIREBASE.md` — panduan ini.

### Folder privat
`private_migration/`
- `firebase_seed.json` — seed asli, termasuk data credential legacy. JANGAN upload ke GitHub publik.
- `Kode_Firebase.gs` — alat migrasi/provisioning.
- `migrasi_firebase.html` — halaman migrasi.

## 3. Struktur database

```text
schools/
  SMKWD/
    security/
      users/
        <firebaseUid>/
          uid
          role
          active
          identifier
          nama
          kelas
      legacyUsers/          PRIVATE
      legacyPiketUsers/     PRIVATE
      sessions/             PRIVATE

    shared/
      students/
        <NISN>/
      teachers/
        <ID_GURU>/
      holidays/
        <YYYY-MM-DD>/
      config/
      schoolSettings/

    apps/
      absensi_siswa/
        attendance/
          <YYYY-MM-DD>_<NISN>/
      absensi_guru/
        attendance/
          <YYYY-MM-DD>_<ID_GURU>/
      piket/
        users/
        jadwal/
        kejadian/
        tugas/
        absensiPetugas/
        pesanHarian/
        settings/
```

`shared/students` dan `shared/teachers` adalah master lintas aplikasi. Transaksi tetap dipisahkan menurut aplikasi.

## 4. Kenapa Firebase Authentication wajib?

Browser langsung ke Firebase berarti browser harus mempunyai identitas Firebase. Security Rules menggunakan `auth.uid` dan data profil/role untuk menentukan akses. Firebase mendokumentasikan pola ini sebagai mekanisme otorisasi client-side yang ditegakkan oleh Rules. 

Jangan pernah memasukkan:
- service-account private key,
- Firebase Admin credential,
- database secret,
- OAuth service credential

ke `index.html` atau GitHub.

Firebase Web API key/config bukan pengganti password server; keamanan data tetap ditentukan oleh Authentication dan Rules.

## 5. Langkah instalasi untuk pemula

### Langkah A — Buat/siapkan Firebase

1. Buka Firebase Console.
2. Pilih project sekolah.
3. Aktifkan **Realtime Database**.
4. Pilih lokasi database.
5. Aktifkan **Authentication**.
6. Pada Authentication → Sign-in method, aktifkan **Email/Password**.
7. Project Settings → General → buat Web App jika belum ada.
8. Salin konfigurasi Firebase Web App.

Firebase saat ini merekomendasikan Firebase Web SDK modular untuk proyek produksi; paket ini menggunakan build `compat` agar aplikasi HTML lama dapat dipindahkan tanpa membongkar seluruh UI sekaligus. Keduanya tetap menggunakan layanan Firebase yang sama.

### Langkah B — Isi `firebase-config.js`

Buka:

`firebase-config.js`

Isi nilai berikut dari Firebase Project Settings:

```javascript
window.SMKWDFirebaseConfig = {
  schoolId: 'SMKWD',
  firebase: {
    apiKey: '...',
    authDomain: '...firebaseapp.com',
    databaseURL: 'https://....firebasedatabase.app',
    projectId: '...',
    storageBucket: '...',
    messagingSenderId: '...',
    appId: '...'
  }
};
```

`databaseURL` harus menunjuk ke Realtime Database yang benar. Firebase mendokumentasikan format URL database berdasarkan lokasi instance.

### Langkah C — Pasang Rules

1. Firebase Console.
2. Realtime Database.
3. Rules.
4. Salin isi `firebase.rules.json`.
5. Publish.

Jangan menggunakan Rules:

```json
".read": true,
".write": true
```

untuk database produksi.

### Langkah D — Import data lama

Gunakan file:

`private_migration/migrasi_firebase.html`

Alurnya:

1. Deploy `private_migration/Kode_Firebase.gs` sebagai Web App.
2. Isi Script Properties sesuai paket migrasi lama:
   - `FIREBASE_DATABASE_URL`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_SERVICE_ACCOUNT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`
   - `FIREBASE_WEB_API_KEY`
   - `SCHOOL_ID=SMKWD`
3. Buka `migrasi_firebase.html` secara lokal.
4. Masukkan URL Web App GAS migrasi.
5. Pilih `private_migration/firebase_seed.json`.
6. Klik **Import Seed ke Firebase**.
7. Tunggu sampai selesai.
8. Klik **Provision Firebase Auth** untuk admin/guru/piket.
9. Klik **Provision akun Siswa**.

Setelah tahap ini selesai, GAS tidak diperlukan lagi untuk operasi absensi harian.

### Langkah E — Akun siswa

Provisioning paket membuat akun siswa dengan pola:

```text
email:
<NISN>@students.smkwd.local

password awal:
<NISN>
```

Contoh:

```text
0089673861@students.smkwd.local
password: 0089673861
```

Ini dipakai agar login siswa yang sebelumnya hanya NISN dapat tetap digunakan saat migrasi.

**Untuk produksi, sebaiknya password awal siswa diganti** dengan password/PIN yang tidak sama dengan NISN.

### Langkah F — Upload ke GitHub Pages

Upload hanya:

```text
index.html
firebase-config.js
firebase-direct.js
firebase.rules.json
firebase.schema.example.json
firebase_tree_admin.html
README_DIRECT_FIREBASE.md
```

Jangan upload:

```text
private_migration/firebase_seed.json
private_migration/Kode_Firebase.gs
```

Jika repository GitHub bersifat public, seed berisi password legacy tidak boleh berada di repository.

## 6. Cara kerja login

### Admin/Guru

Frontend menggunakan Firebase Authentication Email/Password.

Email internal dibuat dari username:

```text
admin → admin@admin.smkwd.local
guru  → guru@guru.smkwd.local
```

Setelah login, aplikasi membaca:

```text
schools/SMKWD/security/users/<uid>
```

untuk memperoleh:

- role,
- active,
- identifier,
- nama,
- kelas.

### Siswa

Siswa menggunakan:

```text
NISN
PIN/password
```

Akun diarahkan ke:

```text
<NISN>@students.smkwd.local
```

Profil siswa tetap berada di:

```text
shared/students/<NISN>
```

## 7. Hak akses

Konsep default paket:

| Peran | Siswa | Guru | Admin |
|---|---:|---:|---:|
| Melihat data siswa | dirinya sendiri | Ya | Ya |
| Mengubah master siswa | Tidak | Tidak | Ya |
| Melihat guru | - | Ya | Ya |
| Mengubah guru | Tidak | Tidak | Ya |
| Membaca absensi siswa | dirinya sendiri | Ya | Ya |
| Menulis absensi siswa | Tidak | Ya | Ya |
| Mengubah status absensi | Tidak | Ya | Ya |
| Mengubah hari libur | Tidak | Ya | Ya |
| Mengubah konfigurasi | Tidak | Tidak | Ya |
| Mengelola kelas | Tidak | Tidak | Ya |

Untuk aplikasi Piket, Rules menyediakan node transaksi yang dapat digunakan oleh akun aktif/petugas sesuai kebutuhan pengembangan aplikasi Piket berikutnya.

## 8. Multi-app

Semua aplikasi menggunakan:

```text
Firebase Project yang sama
        ↓
Realtime Database yang sama
        ↓
schools/SMKWD/
```

Contoh:

### Absensi Siswa

```text
schools/SMKWD/apps/absensi_siswa/
```

### Absensi Guru

```text
schools/SMKWD/apps/absensi_guru/
```

### Piket

```text
schools/SMKWD/apps/piket/
```

Data bersama:

```text
schools/SMKWD/shared/students/
schools/SMKWD/shared/teachers/
schools/SMKWD/shared/holidays/
schools/SMKWD/shared/config/
```

Dengan cara ini aplikasi Absensi Guru dapat membaca master guru yang sama, aplikasi Piket dapat membaca master guru/siswa, dan aplikasi baru di masa depan dapat memakai data master yang sama tanpa menggandakan database.

## 9. Editor pohon JSON

File:

`firebase_tree_admin.html`

dapat digunakan untuk:

- membaca node Firebase,
- memasukkan JSON,
- mengubah struktur,
- menyimpan node,
- mengimpor file JSON,
- mengunduh node JSON.

Gunakan hanya dengan akun admin.

Node yang tersedia di editor:

```text
shared
shared/students
shared/teachers
shared/holidays
shared/config
apps/absensi_siswa
apps/absensi_guru
apps/piket
```

Jangan mencoba mengubah:

```text
security/legacyUsers
security/legacyPiketUsers
security/sessions
```

dari editor client.

## 10. Mengapa data bisa dipakai banyak aplikasi?

Firebase Realtime Database menggunakan satu pohon data yang dapat diakses beberapa client selama setiap client:
1. terhubung ke project Firebase yang sama,
2. melakukan autentikasi,
3. memenuhi Security Rules.

Jadi:

```text
Aplikasi Android Absensi Siswa
             \
Aplikasi Web Absensi Siswa
              \
Aplikasi Absensi Guru ---- Firebase RTDB
              /
Aplikasi Piket ------------
```

Semua client dapat melihat perubahan yang diizinkan oleh Rules.

## 11. Pengujian setelah pemasangan

### Test 1 — Firebase Config

Buka aplikasi.

Jika `firebase-config.js` belum diisi, console browser akan menampilkan:

`Firebase belum dikonfigurasi`.

### Test 2 — Login Admin

Login menggunakan akun admin yang sudah diprovision.

Jika muncul:

`Akun tidak aktif atau profil Firebase belum dibuat`

berarti node:

```text
security/users/<UID>
```

belum ada atau `active` bukan `true`.

### Test 3 — Data siswa

Setelah admin login, buka menu data siswa.

Aplikasi membaca:

```text
shared/students
```

langsung dari Firebase.

Tidak ada request ke GAS.

### Test 4 — Scan QR

Scan NISN siswa.

Aplikasi:
1. mencari siswa di Firebase,
2. membaca konfigurasi,
3. mengecek hari libur,
4. mengecek absensi tanggal berjalan,
5. menulis transaksi langsung ke:

```text
apps/absensi_siswa/attendance/YYYY-MM-DD_NISN
```

### Test 5 — Absensi pulang

Scan siswa yang sudah mempunyai `jamDatang`.

Transaksi yang sama diperbarui dengan `jamPulang`.

### Test 6 — Dua perangkat

Buka aplikasi dari dua perangkat dengan akun yang diizinkan.

Lakukan perubahan pada perangkat pertama.

Perangkat kedua akan dapat membaca data yang sama dari Firebase.

## 12. Pengujian statis yang dilakukan pada paket

Pengujian paket mencakup:

- parsing JSON seed,
- parsing JSON schema,
- parsing JSON Security Rules,
- pemeriksaan JavaScript dengan Node.js,
- pemeriksaan tidak adanya `SpreadsheetApp` pada runtime `index.html`,
- pemeriksaan bahwa URL GAS tidak digunakan oleh `firebase-direct.js`,
- pemeriksaan bahwa credential service account tidak dimasukkan ke frontend,
- pemeriksaan struktur node `schools/SMKWD`,
- pemeriksaan bahwa seed lama tetap tersedia untuk proses migrasi privat.

**Pengujian live ke Firebase Anda belum dapat dilakukan dari paket ini**, karena Firebase project/configuration dan Authentication Anda bersifat milik sekolah dan belum diberikan di percakapan. Jadi status "teruji" di sini berarti static/syntax/struktur; pengujian read/write produksi harus dilakukan setelah `firebase-config.js`, Auth, seed, dan Rules dipasang pada project Firebase Anda.

## 13. Masalah umum

### A. `Permission denied`

Periksa:
1. user sudah login Firebase,
2. `security/users/<UID>` ada,
3. `active=true`,
4. `role` benar,
5. Rules sudah Publish.

### B. Admin berhasil login tetapi data siswa kosong

Periksa:

```text
schools/SMKWD/shared/students
```

harus berisi data.

### C. Guru tidak bisa menulis absensi

Periksa profil:

```text
security/users/<UID>
```

harus:

```json
{
  "role": "guru",
  "active": true
}
```

### D. Siswa tidak bisa login

Pastikan Authentication Email/Password aktif dan akun siswa sudah diprovision.

Format:

```text
<NISN>@students.smkwd.local
```

Password awal:

```text
<NISN>
```

### E. `firebase-config.js` masih menampilkan PASTE_

Berarti konfigurasi Firebase belum diisi.

## 14. Catatan keamanan penting

`firebase_seed.json` dari paket awal mengandung credential legacy/plaintext. Setelah migrasi:

1. Jangan commit seed ke GitHub.
2. Jangan kirim seed melalui grup/chat publik.
3. Ganti password legacy jika masih dipakai.
4. Setelah semua akun pindah ke Firebase Authentication, legacy credential sebaiknya dihapus/diisolasi.
5. Jangan membuat database public hanya agar aplikasi "mudah jalan".

Firebase menjelaskan bahwa Security Rules bekerja di server dan menentukan izin read/write; karena itu aturan database harus dianggap sebagai lapisan keamanan utama, bukan pemeriksaan JavaScript di browser.

## 15. Arsitektur final yang direkomendasikan

```text
                         ┌─────────────────────────┐
                         │ Firebase Authentication  │
                         │ Admin / Guru / Siswa     │
                         └────────────┬────────────┘
                                      │
┌─────────────────┐                   │
│ Web Absensi     │───────────────────┤
└─────────────────┘                   │
┌─────────────────┐                   ▼
│ Android Wrapper │──────────── Firebase RTDB
└─────────────────┘                   │
┌─────────────────┐                   │
│ Absensi Guru    │───────────────────┤
└─────────────────┘                   │
┌─────────────────┐                   │
│ Piket Guru      │───────────────────┘
└─────────────────┘

                  Firebase Rules
                       │
             ┌─────────┴─────────┐
             │                   │
          shared/               apps/
        master data          transaksi
```

GAS:

```text
GAS
 │
 ├── migrasi seed satu kali
 ├── provisioning Authentication satu kali
 └── Admin Mirror opsional
```

GAS **bukan lagi jalur transaksi aplikasi**.

## 16. Tahap lanjutan yang disarankan

Setelah Absensi Siswa stabil, gunakan pola yang sama untuk:

1. Absensi Guru → Firebase direct.
2. Piket Guru → Firebase direct.
3. Android WebView → URL GitHub Pages/Firebase direct.
4. Dashboard monitoring → Firebase listener.
5. Aplikasi admin → Firebase direct.
6. Password siswa → fitur ganti password.
7. Role → dapat ditingkatkan ke Firebase custom claims jika kebutuhan authorization semakin kompleks.

Firebase mendukung custom claims untuk role-based authorization; claims harus dibuat melalui Admin SDK dan kemudian dapat digunakan oleh Security Rules. 


## Provisioning Firebase Authentication (versi revisi)

- NISN adalah identifier berbentuk teks. Tidak ada validasi harus 10 digit.
- Provision siswa dilakukan per batch maksimal 40 akun agar tidak mudah terkena timeout GAS. Jalankan tombol batch berulang sampai selesai.
- Data siswa yang sudah ada di Realtime Database tidak perlu diimport ulang.
- Provision guru mengambil daftar dari `shared/teachers` dan mencocokkan password legacy dari `security/legacyUsers`.
- Jika password legacy guru tidak ditemukan, guru tersebut dilaporkan gagal dan tidak dibuat dengan password tebakan.
- `FIREBASE_WEB_API_KEY` tetap harus tersedia di Script Properties GAS untuk provisioning Authentication.
