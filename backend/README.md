# SUNDAE Backend

On-premise AI Chatbot SaaS Platform for Thai Government & SMEs.

## Quick Start

```bash
# 1. Create virtual environment
python -m venv venv
venv\Scripts\activate   # Windows

# 2. Install dependencies
pip install -r requirements.txt

# 3. Copy and fill environment variables
cp .env.example .env

# 4. Run the dev server
uvicorn app.main:app --reload --port 8000
```

## Project Structure

```
backend/
├── app/
│   ├── main.py               # FastAPI entry point
│   ├── core/config.py        # Settings (env-based)
│   ├── models/schemas.py     # Pydantic models
│   ├── routers/health.py     # Health-check endpoint
│   ├── services/chunking.py  # Parent-Child chunking
│   └── utils/thai_text_splitter.py  # Custom Thai splitter
├── tests/
├── requirements.txt
├── Dockerfile
└── .env.example
```

## Docker

```bash
docker build -t sundae-backend .
docker run -p 8000:8000 --env-file .env sundae-backend
```
