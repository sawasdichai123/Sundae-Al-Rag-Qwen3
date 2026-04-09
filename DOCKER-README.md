# SUNDAE — Docker Deployment Guide

## Prerequisites

- Docker Engine 24+
- Docker Compose v2+
- NVIDIA GPU + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) (สำหรับ Ollama)

---

## Quick Start

```bash
# 1. ตั้งค่า environment
cp backend/.env.example backend/.env
# แก้ไข backend/.env ใส่ค่าจริง (Supabase URL, keys, etc.)

# 2. Set Supabase keys สำหรับ frontend build
export VITE_SUPABASE_URL=https://your-project.supabase.co
export VITE_SUPABASE_ANON_KEY=your-anon-key

# 3. Build & Start
docker compose up -d

# 4. Pull LLM model (ครั้งแรกเท่านั้น)
docker compose exec ollama ollama pull qwen2.5:3b
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| frontend | 3000 | React app (Nginx) |
| backend | 8001 | FastAPI API |
| ollama | 11434 | LLM Engine |

---

## Ollama — GPU / CPU / External

ปัจจุบัน `docker-compose.yml` ตั้งค่าให้ใช้ **NVIDIA GPU** ถ้า server มี spec ต่างกันให้แก้ตามกรณี:

### กรณี 1: Server มี NVIDIA GPU (default)

ใช้ `docker-compose.yml` ได้เลย ไม่ต้องแก้อะไร

```yaml
# docker-compose.yml (ค่าปัจจุบัน)
ollama:
  image: ollama/ollama:latest
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [ gpu ]
```

**ข้อกำหนด:**
- ติดตั้ง NVIDIA Driver + NVIDIA Container Toolkit
- ตรวจสอบ: `nvidia-smi` ต้องแสดงผลได้

### กรณี 2: Server ไม่มี GPU (CPU only)

ลบ `deploy` block ออกจาก ollama service:

```yaml
ollama:
  image: ollama/ollama:latest
  container_name: sundae-ollama
  ports:
    - "11434:11434"
  volumes:
    - ./ollama_data:/root/.ollama
  restart: unless-stopped
  networks:
    - sundae-network
  # ไม่มี deploy.resources — รันบน CPU
```

**ข้อจำกัด:**
- ช้ากว่า GPU 5-20x
- แนะนำใช้ model เล็ก: `qwen2.5:3b` (RAM ~4 GB)
- ไม่แนะนำ model ใหญ่: `qwen3:14b` จะช้ามากบน CPU

### กรณี 3: ใช้ Ollama จาก server อื่น

ลบ ollama service ออกทั้ง block แล้วชี้ URL ใน `docker-compose.yml`:

```yaml
backend:
  environment:
    - OLLAMA_BASE_URL=http://your-ollama-server:11434
  # ลบ depends_on: ollama ออกด้วย
```

### กรณี 4: ใช้ Cloud LLM แทน Ollama (อนาคต)

ถ้าเปลี่ยนไปใช้ OpenAI / Claude API แทน Ollama:
- ลบ ollama service ออก
- แก้ backend code ให้เรียก cloud API
- ไม่ต้องใช้ GPU เลย

---

## LLM Model — เลือกตาม RAM

| Model | RAM ที่ต้องการ | คุณภาพ | ความเร็ว (GPU) |
|-------|---------------|--------|----------------|
| `qwen2.5:3b` | ~4 GB | พอใช้ | เร็ว |
| `qwen2.5:7b` | ~8 GB | ดี | ปานกลาง |
| `qwen3:14b` | ~16 GB | ดีมาก | ช้าหน่อย |

```bash
# เปลี่ยน model
docker compose exec ollama ollama pull qwen2.5:7b

# แก้ LLM_MODEL ใน backend/.env
LLM_MODEL=qwen2.5:7b

# Restart backend
docker compose restart backend
```

---

## Troubleshooting

### Ollama ไม่ start (GPU error)
```
Error: could not select device driver "nvidia"
```
- ตรวจสอบ NVIDIA Driver: `nvidia-smi`
- ตรวจสอบ Container Toolkit: `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi`
- ถ้าไม่มี GPU → ใช้กรณี 2 (CPU only)

### Frontend build ไม่มี Supabase
```
VITE_SUPABASE_URL is empty
```
- ต้อง set env vars ก่อน build:
```bash
VITE_SUPABASE_URL=https://xxx.supabase.co VITE_SUPABASE_ANON_KEY=xxx docker compose up -d --build
```

### Backend ไม่เชื่อม Ollama
- ตรวจสอบ Ollama พร้อม: `curl http://localhost:11434/api/tags`
- ตรวจสอบ model ถูก pull: `docker compose exec ollama ollama list`

### ล้าง build cache แล้ว build ใหม่
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```
