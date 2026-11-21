# LandConnect

A land marketplace mobile application, built in stages. The current checkpoint includes **registration, login, JWT authentication and role checks**, on the FastAPI, PostgreSQL, Alembic and Docker foundation. Listings, chat and calling come in later checkpoints.

## Calling architecture

The agreed media architecture is **WebRTC through a self-hosted LiveKit SFU**, for both one-to-one calls and invite-only group meeting rooms. Mobile clients publish audio/video tracks to the SFU, which forwards them to the other participants. FastAPI owns authentication, invitations, membership checks, call state and short-lived room access tokens. LiveKit owns media transport and its WebRTC signaling.

The `livekit-api` dependency is retained for server-side room management and token generation. The SFU service and calling endpoints will be implemented in the calling stage; they are not running yet. See the [SFU architecture decision](docs/04-sfu-architecture.md) or [PDF explanation](docs/LandConnect%20SFU%20Architecture%20Guide.pdf). The implemented authentication dependencies will supply user identity for those features.

## Start the backend

Requirements: Git, uv and Docker Desktop running Linux containers. Run these commands from the LandConnect directory:

```powershell
uv sync --project backend --locked
uv run --project backend python scripts/init_env.py
docker compose up --build -d
```

`uv sync` creates or reuses `backend/.venv`. You can use `uv run` without activating it. The setup script generates a local `.env` with random secrets and preserves an existing `.env`. Both `.env` and `.venv` are excluded from Git.

Open [Swagger API documentation](http://localhost:8000/docs). The first image build downloads dependencies; the API starts after PostgreSQL is healthy and the migration service succeeds.

```powershell
Invoke-RestMethod http://localhost:8000/health/live
Invoke-RestMethod http://localhost:8000/health/ready
docker compose ps -a
docker compose logs --tail=50 api migrate
```

Readiness returns `503` when PostgreSQL is unavailable or its Alembic revision differs from the migration files. Successful readiness means the foundation is ready; it does not verify future marketplace or media features.

Default local ports are API `8000` and PostgreSQL `55432`. They bind to the local computer only. To use different ports, update `API_PORT` or `POSTGRES_PORT` in `.env`; keep the host port in `DATABASE_URL` consistent. PostgreSQL still uses `db:5432` inside Compose. `DOCKER_DATABASE_URL` supplies that internal connection URL.

If you customize database credentials, keep `POSTGRES_*` and both connection URLs consistent. URL-encode special characters in connection URLs. PostgreSQL initialization settings apply when its data volume is first created; changing `.env` does not change an existing database password.

## Run the API locally with uv

Keep PostgreSQL in Docker and run a second development API on port `8001`:

```powershell
docker compose up -d db
uv run --directory backend python -m alembic upgrade head
uv run --directory backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Local API documentation: <http://localhost:8001/docs>. Root `.env` settings load independently of the working directory. Containers receive settings through Compose environment variables.

## Authentication

| Endpoint | Request | Result |
| --- | --- | --- |
| `POST /auth/register` | JSON email, password, display_name and optional role | `201` user profile; role defaults to buyer |
| `POST /auth/login` | JSON email and password | `200` bearer access token and expires_in seconds |
| `GET /users/me` | `Authorization: Bearer <access_token>` | `200` authenticated user's profile |

Use `/docs` to register and log in. Copy `access_token` from the login response, click **Authorize**, paste the token alone and try `/users/me`. Swagger supplies the Bearer prefix. Other API clients must send the full Authorization header. Login accepts JSON, rather than an OAuth2 password form.

Registration supports `buyer`, `seller` and `broker`. Emails are normalized to lowercase; duplicate accounts return `409`. Passwords must be 12 through 128 characters and are stored as Argon2id hashes. Password whitespace is preserved. User responses omit password hashes, and validation errors omit submitted values.

Access tokens use HS256 and expire after `ACCESS_TOKEN_MINUTES` (default 60). Signature, issuer, audience, expiry, issue time, subject and token purpose are checked. Protected requests load the current user and role from PostgreSQL. `require_roles(Role.seller, Role.broker)` is ready for seller/broker listing endpoints in the next stage; its restrictions are tested using test-only routes.

This is the prototype's access-token flow. Refresh tokens, logout revocation, password recovery and email verification are not implemented. Shared login throttling and HTTPS must be provided before public deployment. Local Compose ports remain bound to the computer's loopback interface.

## Database migrations

```powershell
uv run --directory backend python -m alembic current
uv run --directory backend python -m alembic check
```

After a model change, generate a new migration, review its `upgrade` and `downgrade`, then apply it:

```powershell
uv run --directory backend python -m alembic revision --autogenerate -m "describe the schema change"
uv run --directory backend python -m alembic upgrade head
```

Commit reviewed migrations with their model changes. Rebuild the image when code or migrations change. `docker compose up --build -d` applies pending migrations through the one-off `migrate` service before starting the API. The application never creates tables with `create_all`.

## Checks

Run unit tests and code checks from the project root:

```powershell
uv run --directory backend python -m pytest -q
uv run --project backend ruff check backend scripts
uv run --project backend ruff format --check backend scripts
```

Without `TEST_POSTGRES_URL`, three PostgreSQL integration tests are skipped. To run the complete suite against the development database configured in `.env`:

```powershell
uv run --directory backend python -c "import os,pytest; from app.core.config import get_settings; os.environ['TEST_POSTGRES_URL']=get_settings().database_url; raise SystemExit(pytest.main(['-q']))"
```

Integration tests create unique temporary schemas and remove them after use. They check registration/login/profile behavior, schema/model consistency, migration rollback and reapply, and database constraints without downgrading application tables. The test database user needs permission to create schemas. Current validation: **63 tests passed**; the installed TestClient emits one upstream HTTPX deprecation warning.

## Files and explanations

- `backend/app/main.py`: application assembly, CORS and lifecycle management.
- `backend/app/api/router.py`: central API route registration.
- `backend/app/api/routes/health.py`: liveness and readiness endpoints.
- `backend/app/api/routes/auth.py` and `users.py`: registration, login and private profile endpoints.
- `backend/app/api/deps.py`: authenticated-user and role dependencies.
- `backend/app/api/errors.py`: validation responses that omit submitted values.
- `backend/app/core/config.py`: environment validation and cached settings.
- `backend/app/core/security.py`: password hashing and access-token creation/validation.
- `backend/app/schemas/`: validated request and response contracts.
- `backend/app/services/auth.py`: account creation and credential verification.
- `backend/app/db/base.py`: declarative base and constraint naming conventions.
- `backend/app/db/session.py`: connection engine and request session dependency.
- `backend/app/models/`: one file per entity, shared enums, helpers and explicit model exports.
- `backend/tests/unit/` and `backend/tests/integration/`: isolated unit and PostgreSQL checks.
- `backend/alembic/`: versioned schema changes, starting at `0001_initial`.
- `backend/Dockerfile` and `compose.yaml`: API image, PostgreSQL and migration startup.
- [Step 1 guide](docs/LandConnect%20Backend%20Step%201%20Guide.pdf): initial scaffold explanation and full assignment roadmap.
- [Step 2 explanation](docs/02-backend-foundation.md) and [PDF guide](docs/LandConnect%20Backend%20Step%202%20Guide.pdf): foundation checkpoint before the directory refactor.
- [Backend structure explanation](docs/03-backend-structure.md): current directory tree, imports and the rules for adding models and future features.
- [Backend structure PDF guide](docs/LandConnect%20Backend%20Structure%20Guide.pdf): printable explanation of the refactor.
- [Authentication explanation](docs/05-authentication.md) and [PDF guide](docs/LandConnect%20Authentication%20Guide.pdf): this stage's code, API walkthrough and verification.

The structure separates HTTP handlers, configuration, persistence and models. Import `get_settings` from `app.core.config` and `get_db` from `app.db.session`. Import individual models from their modules or use the public exports in `app.models`. The models package imports every entity so Alembic receives the complete metadata registry. Importing it does not initialize a database engine.

Git is initialized at the project root on `main`. Keep `uv.lock` in Git; `.env` and virtual environments are excluded.

## Stop the containers

```powershell
docker compose down
```

PostgreSQL data and uploads are stored in named volumes, which this command preserves. LiveKit deployment, the mobile interface and whole-application media testing will be added in their own stages. The next checkpoint is **community listings and property management**, after you say **next**.
