FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PYTHONPATH=/app/src

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY web/ ./web/
COPY run.json ./run.json

# Cloud Run supplies $PORT.
CMD exec uvicorn web.app:app --host 0.0.0.0 --port ${PORT:-8080}
