
# ── Frontend build stage ──────────────────────────────────────────────
FROM node:20-slim AS frontend-builder

WORKDIR /frontend

COPY Frontend/package.json Frontend/package-lock.json ./
RUN npm ci --ignore-scripts

# Firebase web config — passed in from CI as --build-arg so the values
# get baked into the JS bundle (Firebase keys are public by design).
# Without these, initializeApp() throws at module load and the SPA
# white-screens. VITE_BASE=/ forces absolute asset paths so nested SPA
# routes (e.g. /chef-remote) can resolve /assets/... correctly.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_BASE=/ \
    VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY} \
    VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN} \
    VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID} \
    VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID} \
    VITE_FIREBASE_MESSAGING_SENDER_ID=${VITE_FIREBASE_MESSAGING_SENDER_ID}

# Copy sources and build — produces /frontend/dist
COPY Frontend/ ./
RUN npm run build

FROM python:3.11-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Dependencies stage ────────────────────────────────────────────────
FROM base AS dependencies

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

FROM base AS production

COPY --from=dependencies /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=dependencies /usr/local/bin /usr/local/bin

COPY Backend/ ./Backend/
COPY Src/ ./Src/
COPY run.py .

COPY --from=frontend-builder /frontend/dist ./frontend/dist

RUN mkdir -p Src/Image_classifier/models && \
    python -c "from huggingface_hub import hf_hub_download; hf_hub_download(repo_id='Kashyapk07/NutriSense_ConvNext_Small_Best', filename='nutrisense_convnext_small_best.pth', local_dir='Src/Image_classifier/models')"

# Pre-download Whisper model so container startup doesn't block on network I/O
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('small.en', device='cpu', compute_type='int8')"

RUN mkdir -p temp_uploads

EXPOSE 8000

ENV PYTHONPATH=/app

ENV MODEL_PATH=Src/Image_classifier/models/nutrisense_convnext_small_best.pth \
    STT_MODEL_SIZE=small.en \
    STT_DEVICE=cpu \
    STT_COMPUTE_TYPE=int8 \
    STT_BACKEND=faster-whisper

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:${PORT:-8000}/health', timeout=5)"

CMD uvicorn Backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
