# KIM-AGENT Architecture Documentation

## Overview
kim-agent adalah autonomous AI executive assistant yang berjalan di WhatsApp via WAHA gateway.

## Data Flow
```
WhatsApp → WAHA → Webhook → BurstDebouncer → Router
                                               ├── FastCommand (#) → SQLite → Response
                                               └── ReActLoop → LLMRotator → Tools → Response
                                                                              ├── SQLite Tools
                                                                              ├── Python Runner
                                                                              └── Memory/Skills
```

## Key Design Decisions

### 1. FIFO Burst Debouncer
Menggabungkan pesan berturut-turut dalam window 1000ms untuk mencegah fragmentasi pesan
dan pemborosan kuota LLM.

### 2. Multi-Key Rotator
Pool API keys dengan round-robin dan exponential backoff untuk 429 rate limits.
Support Gemini primary + OpenRouter fallback.

### 3. WAL Mode SQLite
Write-Ahead Logging memungkinkan concurrent reads tanpa blocking writes.
Checkpoint dijalankan setiap 6 jam dan saat shutdown.

### 4. InstaBox Resilience
- Docker volumes untuk state persistence across pause/resume
- `restart: unless-stopped` policy
- SIGTERM handler untuk WAL checkpoint sebelum shutdown
- `instabox-resilience.sh` cron untuk auto-recovery

### 5. Voyager Crystallization
Interaksi multi-step yang berhasil di-analyze di background (queueMicrotask)
dan disimpan sebagai procedural skill yang bisa di-retrieve oleh ReAct loop
untuk menangani pertanyaan serupa lebih efisien.
