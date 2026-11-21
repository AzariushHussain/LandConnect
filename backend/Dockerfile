FROM ghcr.io/astral-sh/uv:0.11.32 AS uv

FROM python:3.12-slim-bookworm
COPY --from=uv /uv /usr/local/bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY app ./app
COPY alembic.ini ./
COPY alembic ./alembic
RUN useradd --create-home --uid 10001 appuser \
    && mkdir /app/uploads \
    && chown appuser:appuser /app/uploads
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--ws-max-size", "8192"]
