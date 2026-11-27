# Build the React studio separately so the Python runtime image stays lean.
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app
COPY VERSION ./VERSION
COPY frontend/package.json frontend/package-lock.json ./frontend/
WORKDIR /app/frontend
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OVC_HOST=0.0.0.0 \
    OVC_HOSTED_DSP_ONLY=true \
    OVC_UPDATE_CHECK_ENABLED=false

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements-free.txt ./backend/requirements-free.txt
RUN pip install --no-cache-dir -r backend/requirements-free.txt

COPY backend/ ./backend/
COPY VERSION ./VERSION
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/models /app/data
EXPOSE 10000
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
