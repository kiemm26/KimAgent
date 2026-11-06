# Crystallization Template — Procedural Memory

## Format Skill Baru

Gunakan template ini saat mengkristalisasi skill dari interaksi sukses:

```markdown
---
skill_id: [auto-generated UUID]
title: [Judul singkat deskriptif]
description: [1-2 kalimat tentang apa yang skill ini lakukan]
trigger_patterns:
  - [contoh kalimat user yang memicu skill ini]
  - [contoh lain]
tools_used:
  - [tool_name]
created_at: [ISO timestamp]
usage_count: 0
success_rate: 1.0
---

## Prosedur

### Input yang Diharapkan
[Deskripsikan format/tipe input dari user]

### Langkah-Langkah
1. **Step 1:** [Thought & Action pertama]
   - Tool: `tool_name(params)`
   - Expected Output: [deskripsi output]

2. **Step 2:** [Thought & Action kedua]
   - Tool: `tool_name(params)`
   - Expected Output: [deskripsi output]

### Output Final
[Format jawaban yang dikirim ke user]

### Catatan & Edge Cases
- [Edge case 1]
- [Edge case 2]
```
