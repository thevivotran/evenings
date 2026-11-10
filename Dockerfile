FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 DB_PATH=/data/evenings.db TZ=Asia/Ho_Chi_Minh
WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
RUN mkdir /data && chown 1000:1000 /data
USER 1000:1000
VOLUME /data
EXPOSE 8080

# Single worker on purpose: SQLite + in-process push threads, ~50 MB RAM.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"]
