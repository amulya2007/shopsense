FROM python:3.12-slim

WORKDIR /app
COPY analytics_api/requirements.txt ./analytics_api/requirements.txt
RUN pip install --no-cache-dir -r analytics_api/requirements.txt
COPY analytics_api ./analytics_api

EXPOSE 8000
CMD ["uvicorn", "analytics_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
