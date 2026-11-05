# Implementation Plan: Fitur Hapus Akun (Delete Account)

Dokumen ini menjelaskan rancangan teknis dan rencana implementasi fitur **Hapus Akun Pengguna** pada aplikasi **Blip**.

---

## 1. Tujuan Fitur
Memberikan kontrol penuh kepada pengguna untuk menghapus akun mereka secara mandiri dari aplikasi kapan saja, dengan jaminan:
- Seluruh data akun pengguna terhapus bersih dari database (`blip_users`).
- Seluruh riwayat percakapan (`blip_messages`) dan relasi pertemanan (`blip_friendships`) terhapus (didukung oleh `ON DELETE CASCADE`).
- File media/foto yang terkait (foto profil di `storage/app/public/avatars/` dan foto chat jika ada) dihapus dari disk fisik server.
- Session cookie dan token lokal browser dihapus sehingga pengguna otomatis diarahkan ke akun tamu baru atau halaman inisialisasi awal.
- Notifikasi realtime (Reverb) dikirimkan ke teman aktif agar tampilan obrolan/radar di teman langsung terputus secara otomatis (`friend_removed` / chat close).

---

## 2. Alur Pengguna (User Experience / UX)
1. **Lokasi Tombol**:
   - Di panel **Pengaturan Akun** (`#profileModal`), diletakkan zona bahaya (*Danger Zone*) di bagian bawah form dengan tombol **"Hapus Akun Ini"** berwarna merah minimalis.
2. **Dialog Konfirmasi (Double Confirmation via SweetAlert2)**:
   - Karena aksi ini tidak dapat dibatalkan (*irreversible*), muncul modal konfirmasi SweetAlert2:
     - **Judul**: *"Hapus Akun Permanen?"*
     - **Pesan**: *"Semua riwayat chat, pertemanan, dan foto profil Anda akan dihapus permanen dari server. Tindakan ini tidak dapat dibatalkan."*
     - **Tombol Konfirmasi**: *"Ya, Hapus Akun"* (Danger Merah) & *"Batal"*.
3. **Proses & Post-Delete Action**:
   - Menampilkan loading spinner pada SweetAlert saat proses penghapusan berlangsung.
   - Setelah server sukses menghapus akun:
     - `localStorage` dibersihkan dari token lama (`blip_session_token`).
     - Web browser otomatis me-reload halaman untuk menginisialisasi sesi akun baru secara mulus.

---

## 3. Rincian Teknis Backend (Laravel)

### A. Endpoint API
- **Method**: `DELETE`
- **Route**: `/api/blip/account`
- **Controller**: `App\Http\Controllers\BlipController@deleteAccount`
- **Auth**: Header `X-Blip-Token` atau cookie sesi `blip_session_token`.

### B. Logika Penghapusan di `BlipController`:
1. Dapatkan model `$user = $this->resolveUser($request)`.
2. **Hapus File Foto Profil**:
   - Cek `$user->avatar_url`.
   - Hapus berkas fisik dari `storage/app/public/avatars/{filename}` jika ada.
3. **Hapus File Foto Pesan**:
   - Ambil pesan yang dikirim oleh `$user` yang bertipe `'image'` dan memiliki file `photo_path`.
   - Hapus file fisik dari `storage/app/public/{photo_path}`.
4. **Broadcast Notifikasi ke Teman (Optional/Realtime)**:
   - Kirim event Reverb `friend.notification` dengan tipe `friend_removed` kepada semua teman yang berelasi dengan user tersebut agar chat room di sisi lawan otomatis tertutup.
5. **Hapus Record Akun**:
   - Panggil `$user->delete()`. Karena tabel `blip_friendships` dan `blip_messages` menggunakan foreign key `onDelete('cascade')`, seluruh data terkait di database akan otomatis terhapus tanpa orphan data.
6. **Hapus Cookie Sesi**:
   - Return JSON response dengan status `success` dan instruksi hapus cookie `blip_session_token` (`Cookie::forget('blip_session_token')`).

---

## 4. Rincian Teknis Frontend (Blade & JavaScript)

### A. Tampilan Blade (`resources/views/blip.blade.php`)
- Menambahkan section Danger Zone di dalam formulir edit akun:
  ```html
  <div style="margin-top: 1.75rem; padding-top: 1.25rem; border-top: 1px dashed var(--border-color); display: flex; justify-content: space-between; align-items: center;">
      <div>
          <div style="font-weight: 600; font-size: 0.85rem; color: #ef4444;">Hapus Akun</div>
          <div style="font-size: 0.74rem; color: var(--text-muted);">Hapus akun dan semua riwayat obrolan secara permanen.</div>
      </div>
      <button type="button" class="btn btn-sm btn-outline" onclick="confirmDeleteAccount()" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.35);">
          <i class="fa-solid fa-trash-can"></i> Hapus
      </button>
  </div>
  ```

### B. JavaScript (`public/js/app.js`)
- **Fungsi `confirmDeleteAccount()`**:
  - Memanggil `Swal.fire` dengan tema kustom Blip.
  - Memanggil fungsi eksekusi `handleDeleteAccount()`.
- **Fungsi `handleDeleteAccount()`**:
  - Melakukan `fetch('/api/blip/account', { method: 'DELETE', headers: getHeaders() })`.
  - Jika sukses:
    - Menghapus item dari `localStorage` (`localStorage.removeItem('blip_session_token')`).
    - Menampilkan pesan notifikasi sukses dan reload window (`window.location.reload()`).

---

## 5. Rencana Pengujian (Testing Steps)
1. Buka akun A dan akun B di browser berbeda (misal Chrome dan Firefox/Incognito).
2. Saling add teman dan kirim beberapa pesan & foto.
3. Di akun A, buka Pengaturan Akun -> Klik tombol **"Hapus"** pada zona Hapus Akun.
4. Klik **Batal** pada SweetAlert -> pastikan proses batal dan akun tetap ada.
5. Klik **"Hapus"** kembali lalu konfirmasi **"Ya, Hapus Akun"**.
6. Verifikasi:
   - Halaman browser A melakukan reload dan mendapatkan akun baru/bersih.
   - Foto profil akun A di folder storage terhapus.
   - Di browser B, riwayat teman akun A otomatis terhapus atau tertutup.
   - Di database `blip_users`, record user A sudah tidak ada lagi.

