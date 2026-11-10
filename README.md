<div align="center">

# 🤖 KIM-AGENT

### *Autonomous AI Executive Assistant for WhatsApp*

Powered by **Gemini + ReAct Reasoning Engine + Isolated Python Sandbox**

[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?style=flat&logo=nodedotjs)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat&logo=docker)](https://www.docker.com/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL%20Mode-003B57?style=flat&logo=sqlite)](https://www.sqlite.org/)
[![Python](https://img.shields.io/badge/Python-3.12%20Sandbox-3776AB?style=flat&logo=python)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## 🌟 Highlights

**KIM-AGENT** adalah asisten eksekutif AI mandiri yang terhubung langsung ke **WhatsApp** via [WAHA (WhatsApp HTTP API)](https://waha.devlike.pro/). KIM menggabungkan model LLM canggih (Google Gemini) dengan arsitektur reasoning **ReAct (Reasoning + Acting)** untuk mengelola tugas, catatan, pengingat, analisis data, hingga mengeksekusi kode Python dan membuat grafik secara langsung dari percakapan WhatsApp.

---

## ✨ Fitur Utama

- 🧠 **ReAct Reasoning & Tool Execution**: Menjalankan siklus *Thought ➔ Action ➔ Observation* hingga mencapai *Final Answer* dengan batas hingga 8 langkah reasoning cerdas.
- 🔄 **Multi-Account & Multi-Model Pool (Anti-Quota Exhausted)**:
  - Rotasi round-robin antar API Key.
  - **Multi-Model Fallback**: Jika kuota `gemini-3.5-flash` habis (HTTP 429), otomatis berpindah ke `gemini-3-flash-preview` atau `gemini-2.5-flash` tanpa memutus percakapan.
  - Deteksi dan isolasi otomatis untuk key yang tidak valid (401 Blacklist).
  - Dukungan fallback darurat ke OpenRouter.
- 🐍 **Isolated Python 3.12 Sandbox**:
  - Menjalankan analisis data dengan Pandas, NumPy, dan kalkulasi matematika kompleks.
  - **Auto-Chart Generation**: Menggambar grafik dengan Matplotlib dan langsung mengirimkan hasilnya sebagai gambar/foto ke chat WhatsApp.
  - Eksekusi thread-safe dengan batas timeout & memori terisolasi.
- ⚡ **FIFO Burst Debouncer**: Menggabungkan rentetan pesan yang dikirim cepat dalam window 1 detik untuk menghemat token dan menjaga konteks tetap utuh.
- 🗄️ **Zero-Maintenance SQLite (WAL Mode)**:
  - Database terpasang bawaan dengan mode Write-Ahead Logging (ultra-cepat, concurrent read/write).
  - Manajemen Todos, Notes, Reminders, dan Conversation History tersimpan rapi.
- 📲 **Zero-Drop WhatsApp Session**:
  - Konfigurasi volume persisten memastikan Anda **tidak perlu scan QR ulang** saat melakukan update kode atau me-restart container.
- 🛡️ **Anti-Hallucination Guardrails**: Memberikan badge sitasi data asli (`[^db]`, `[^calc]`, `[^web]`).

---

## 🏛️ Arsitektur Sistem

```
      ┌─────────────────────────┐
      │     WhatsApp User       │
      └────────────┬────────────┘
                   │
                   ▼
      ┌─────────────────────────┐
      │  WAHA Gateway (Port 3000)│
      └────────────┬────────────┘
                   │ Webhook (POST /api/webhook)
                   ▼
      ┌─────────────────────────┐
      │   FIFO Burst Debouncer  │ ── (Aggregates rapid messages)
      └────────────┬────────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │   Message Router    │
        └──────┬───────┬──────┘
               │       │
    Fast Cmd   │       │  Natural Chat
    (#...)     │       │
               ▼       ▼
    ┌────────────┐   ┌──────────────────────────────────────────────┐
    │ SQLite CLI │   │            ReAct Reasoning Engine            │
    └────────────┘   │   (Thought ➔ Action ➔ Observation Loop)      │
                     └──────┬───────────────────────┬───────────────┘
                            │                       │
                            ▼                       ▼
                 ┌────────────────────┐   ┌─────────────────────────┐
                 │  LLM Rotator Pool  │   │     Tools Registry      │
                 │ ┌────────────────┐ │   │ ├── SQLite Tools        │
                 │ │ Gemini Keys    │ │   │ ├── Reminders Scheduler │
                 │ ├────────────────┤ │   │ └── Python Runner       │
                 │ │ Multi-Models   │ │   │     (Pandas/Matplotlib) │
                 │ ├────────────────┤ │   └─────────────────────────┘
                 │ │ OpenRouter     │ │
                 │ └────────────────┘ │
                 └────────────────────┘
```

---

## ⚡ Perintah Cepat (Deterministic Commands)

Selain percakapan biasa untuk dijawab oleh AI, Anda dapat menggunakan perintah cepat berawalan `#` yang dieksekusi secara instan (<5ms):

| Perintah | Deskripsi |
|---|---|
| `#health` | Cek status kesehatan: memori, koneksi Python Runner, dan kesehatan seluruh slot API Key/Model |
| `#ping` | Cek respon bot, uptime server, dan penggunaan RAM |
| `#waha` | Cek status koneksi gateway WhatsApp dan sesi login |
| `#todo [status]` | Melihat daftar tugas (`pending`, `done`, `all`) |
| `#add [tugas]` | Menambahkan tugas baru ke daftar todo |
| `#done [id]` | Menandai tugas selesai berdasarkan nomor ID |
| `#reminders` | Melihat daftar pengingat aktif |
| `#skills` | Melihat memori prosedural yang telah dipelajari bot |
| `#clear` | Membersihkan riwayat percakapan sesi aktif |
| `#checkpoint` | Memicu SQLite WAL checkpoint manual |
| `#help` | Menampilkan bantuan perintah cepat |

---

## 🚀 Panduan Memulai (Quick Start)

### Prasyarat
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/) terinstal di mesin lokal atau VPS (Linux/macOS/Windows).
- API Key Gemini gratis dari [Google AI Studio](https://aistudio.google.com/) (disarankan 1–2 key).

---

### 1. Clone Repositori

```bash
git clone https://github.com/kiemm26/KimAgent.git
cd KimAgent
```

---

### 2. Konfigurasi Environment

Salin file `.env.example` menjadi `.env`:

```bash
cp .env.example .env
```

Sesuaikan variabel penting di file `.env`:

```env
PORT=4000
OWNER_JID=*

# API Keys Gemini (pisahkan dengan koma jika lebih dari satu)
GEMINI_KEYS=AIzaSyAxxxxxxx,AIzaSyByyyyyyy

# Multi-Model Fallback (otomatis berganti jika salah satu model habis kuotanya)
GEMINI_MODELS=gemini-3.5-flash,gemini-3-flash-preview,gemini-2.5-flash
GEMINI_MODEL=gemini-3.5-flash
GEMINI_FALLBACK_MODEL=gemini-3-flash-preview

# Python Runner Secret
PYTHON_RUNNER_SECRET=ganti_dengan_secret_pilihan_anda
```

---

### 3. Jalankan Aplikasi dengan Docker Compose

```bash
docker compose up -d --build
```

Pastikan ketiga service (`kim-waha`, `kim-core`, `kim-python-runner`) berstatus **Up (healthy)**:
```bash
docker compose ps
```


---

### 4. Hubungkan WhatsApp (Scan QR)

1. Buka browser dan akses WAHA Dashboard:
   - Lokal: `http://localhost:3000/dashboard`
   - VPS: `http://<IP-VPS-ANDA>:3000/dashboard`
2. Masukkan kredensial default:
   - **Username**: `admin`
   - **Password**: `admin12345`
3. Klik pada sesi **`default`**, lalu klik tombol **Start**.
4. Klik ikon kamera / **Scan QR**, lalu scan QR code menggunakan aplikasi WhatsApp di ponsel (*Perangkat Tertaut / Linked Devices*).
5. Tunggu hingga status sesi berubah menjadi **`WORKING`**.

> 🎉 **KIM-AGENT siap digunakan!** Kirim pesan *"Halo Kim"* atau ketik `#health` di chat WhatsApp Anda.

---

## 🔄 Pemeliharaan & Update Tanpa Scan Ulang

Berkat volume mount persisten `./data/waha:/app/.sessions`, sesi login WhatsApp Anda tersimpan aman.

Jika Anda memperbarui kode dari Git atau mengubah `.env`:
```bash
git pull
# Rebuild HANYA kim-core (WAHA tetap berjalan, TIDAK perlu scan QR lagi!)
docker compose up -d --build kim-core
```

Jika mengubah service sandbox Python:
```bash
docker compose up -d --build python-runner
```

---

## 🛠️ Pengembangan Lokal (Tanpa Docker)

```bash
npm install
npm run build
./scripts/start-local.sh
```

---

## 📂 Struktur Proyek

```
kim-agent/
├── config/              # Konfigurasi default & template prompt
│   ├── default.json
│   └── prompts/         # System prompt, anti-hallucination guardrails
├── data/                # Data persisten (DB SQLite, media, sesi WAHA)
├── runner/              # Python 3.12 Isolated Sandbox (FastAPI)
│   ├── main.py          # REST server endpoints (/execute, /chart)
│   ├── sandbox.py       # Thread-safe code execution engine
│   └── Dockerfile
├── scripts/             # Script otomasi & deployment
├── src/                 # Kode sumber TypeScript
│   ├── core/            # ReAct Loop, Router, Fast Command parser
│   ├── db/              # Driver SQLite (better-sqlite3) & Skema SQL
│   ├── gateway/         # Klien WAHA & Burst Debouncer
│   ├── llm/             # Multi-Key & Multi-Model Rotator
│   │   └── providers/   # Adaptor Gemini SDK & OpenRouter
│   ├── memory/          # Konteks pesan & Voyager crystallization
│   ├── tools/           # Tool registry (DB, Python runner, Reminders)
│   ├── server.ts        # Native Node HTTP server & Webhook endpoint
│   └── index.ts         # Entry point aplikasi
├── docker-compose.yml   # Orkestrasi container
├── Dockerfile           # Multi-stage build Node 22 Alpine
└── README.md
```

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah lisensi [MIT](LICENSE). Bebas digunakan dan dimodifikasi untuk keperluan pribadi maupun komersial.

---

<div align="center">
Dibuat dengan ❤️ oleh <b>Muhammad Hamdi</b>
</div>

