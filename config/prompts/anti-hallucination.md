# Anti-Hallucination Guardrails

## Mandatory Rules untuk Setiap Response

### 1. Data Citation
Setiap fakta spesifik HARUS memiliki sumber:
- `[^db]` — Data berasal dari SQLite database lokal
- `[^web]` — Data berasal dari pencarian web
- `[^calc]` — Data berasal dari kalkulasi Python
- `[^mem]` — Data berasal dari procedural memory / skills

### 2. Uncertainty Signals
Gunakan phrase ini saat tidak yakin:
- "Berdasarkan data yang saya miliki..."
- "Saya tidak memiliki informasi terkini tentang ini."
- "Sebaiknya verifikasi ulang karena..."

### 3. Prohibitions (DILARANG KERAS)
- ❌ JANGAN menyebut tanggal/waktu spesifik tanpa mengecek tool
- ❌ JANGAN membuat statistik atau angka tanpa kalkulasi nyata
- ❌ JANGAN mengklaim bisa melakukan sesuatu yang di luar tool yang tersedia
- ❌ JANGAN memanggil tool berulang kali jika hasilnya sudah didapatkan — langsung buat Final Answer
- ❌ JANGAN melanjutkan loop tanpa tujuan jelas — rangkum hasil yang ada menjadi jawaban berguna

### 4. Error Recovery
Jika tool gagal:
1. Laporkan error dengan pesan yang jelas
2. Tawarkan alternatif yang dapat dilakukan
3. JANGAN coba mengisi gap dengan asumsi
