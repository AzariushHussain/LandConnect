# LandConnect Backend Step 2 Guide

This is the historical foundation checkpoint. The [backend structure guide](03-backend-structure.md) documents current module paths after the directory refactor. The Step 1 and Step 2 PDFs retain their original checkpoint layouts.

Runnable foundation with Git uv FastAPI Alembic and Docker

This checkpoint turns the initial scaffold into a running backend. Git now covers the whole project, uv manages the Python environment, PostgreSQL has the versioned schema, and the containerized API exposes health checks and interactive documentation. Authentication and marketplace endpoints remain for later stages.

## 1 Understand the startup flow

```text
docker compose up --build -d
    |
    +-- db starts PostgreSQL and passes its health check
    |
    +-- migrate runs Alembic and exits successfully
    |
    +-- api starts FastAPI and passes its readiness check
```

The database contains nine application tables plus Alembic's version table. Creating these tables prepares storage for users, properties and communications; it does not implement their API features. This stage deliberately stops at the runnable foundation.

The public endpoints in this checkpoint are GET /health/live, GET /health/ready, /docs, /redoc and /openapi.json. Open http://localhost:8000/docs to inspect the two health operations and run them interactively.

The most useful files to read now are app/main.py, alembic/env.py, the initial migration, Dockerfile and compose.yaml, under backend where applicable. The README contains the setup commands and links to both explanation guides.

## What changed from Step 1

The root repository uses the main branch. Dependencies still come from backend/pyproject.toml and backend/uv.lock. The virtual environment is backend/.venv. A setup script creates local secrets. Environment loading now uses the absolute path to the root .env rather than depending on the current working directory.

The latitude and longitude annotations now use Decimal, matching their Numeric database columns. String enums use Python 3.12's StrEnum. These are model clarifications; the permitted role, status and call values remain the same.

<!-- pagebreak -->

## 2 Git and the uv environment

Git was initialized in the LandConnect directory, so it will track backend, infrastructure, documentation and the future mobile application together. It is on main. No initial commit or remote has been created.

```powershell
git status --short
uv sync --project backend --locked
uv run --project backend python scripts/init_env.py
```

uv sync creates or reuses backend/.venv and installs the dependency versions in uv.lock. The locked flag refuses an outdated lockfile instead of silently changing it. backend/.python-version selects Python 3.12. The host environment was verified to use Python 3.12.5; the Docker image uses its own Python 3.12 interpreter.

uv run selects the project environment automatically. Manual activation is optional, so these commands do not require changing PowerShell's execution policy. Do not copy the Windows virtual environment into Docker; the image creates a fresh Linux environment from the same lockfile.

## How local settings are created

scripts/init_env.py reads .env.example, replaces its development password and secrets with random hexadecimal values and writes .env. The password is replaced in both database connection URLs so they stay consistent. It uses exclusive creation mode, which preserves an existing file on subsequent runs.

```python
with target.open("x", encoding="utf-8", newline="\n") as output:
    output.write(values)
```

The script prints a status message rather than the generated credentials. .gitignore excludes .env, other local environment files, the virtual environment, caches and uploaded media. .env.example remains versioned as a setup reference. Keep uv.lock in Git so another developer and the container builder can resolve the same locked Python dependencies.

DATABASE_URL points to 127.0.0.1:55432 for Python processes running on the computer. DOCKER_DATABASE_URL points to db:5432 for containers. Compose supplies the latter as DATABASE_URL inside the API and migration services. This avoids confusing a container's localhost with the host computer.

<!-- pagebreak -->

## 3 The FastAPI application

backend/app/main.py creates the application, adds CORS middleware and defines health endpoints. Uvicorn imports the app object using app.main:app. The interactive API documentation is generated from those route definitions.

```python
app = FastAPI(
    title="LandConnect API",
    version="0.1.0",
    lifespan=lifespan,
)
```

The lifespan handler disposes of the database connection pool when the application stops. Database tables are not created during application startup. A separate migration step owns schema changes, keeping database evolution explicit and reviewable.

## Liveness and readiness answer different questions

GET /health/live returns {"status": "ok"} without requesting a database session. It tells an operator that the application process is serving requests. A temporary database failure should not turn this into a claim that the application process itself has stopped.

GET /health/ready obtains a session through Depends(get_db), runs SELECT 1 and reads the database's current Alembic heads. It compares them with the migration heads in the shipped code. It returns 200 only when the connection works and the revision sets match.

```json
{"status": "ready", "database": "ok", "migrations": "current"}
```

A connection or SQLAlchemy error returns 503 with Database unavailable. Missing or outdated migrations return 503 with Database migrations are pending. Raw connection errors and credentials are not returned to the caller. PostgreSQL connections have a three-second connection timeout in the app and migration environment.

This checks connectivity and the recorded revision. It does not detect someone manually changing a table without changing that revision; alembic check provides a separate model/schema comparison. It also does not verify audio/video transport, which is not deployed yet.

## CORS configuration

The allowed browser origins come from CORS_ORIGINS. The initial values cover localhost ports 8081 and 3000. Authorization and Content-Type are allowed request headers. Tests verify that an allowed origin receives the expected preflight response and an unlisted origin does not. CORS is a browser policy and does not replace login or endpoint permissions.

<!-- pagebreak -->

## 4 Alembic and the initial database schema

backend/alembic.ini locates the migration directory relative to its own path. backend/alembic/env.py imports Base from app.models so all table definitions are registered before comparison. It obtains the URL from validated environment settings instead of storing credentials in the INI file.

```python
target_metadata = Base.metadata
```

The generated and reviewed revision is 0001_initial. Its upgrade function explicitly creates tables, constraints and indexes. Its downgrade reverses their dependency order. The migration is a snapshot of this schema; it does not import the current model definitions and recreate whatever those happen to contain later.

Users are created before their dependent tables. Listings precede listing images. Meetings precede meeting members. Conversations precede messages. Foreign keys preserve these relationships. Named checks enforce valid prices, areas, coordinates, enum values and participant combinations at the database layer.

## Commands for an existing development database

Run these from the LandConnect root after PostgreSQL is running:

```powershell
uv run --directory backend python -m alembic upgrade head
uv run --directory backend python -m alembic current
uv run --directory backend python -m alembic check
```

upgrade head applies migrations that have not run. current shows the recorded revision. check compares the live schema with the models and fails if another migration would be needed. The application database was upgraded to 0001_initial and the comparison reported no new upgrade operations.

## How a future schema change will work

First change the relevant model, then generate a new revision:

```powershell
uv run --directory backend python -m alembic revision `
    --autogenerate -m "describe the schema change"
```

Review the generated upgrade and downgrade before applying them. Autogeneration is an assistant, not a substitute for reviewing data changes or renames. Apply the reviewed revision with upgrade head, then run the relevant tests. Keep the new migration and model change together in Git. Rebuild the image before running updated code in Docker.

Downgrade testing in this checkpoint runs only in newly created test schemas. The development application's tables were not downgraded.

<!-- pagebreak -->

## 5 Docker image and Compose services

The Dockerfile starts from Python 3.12 slim and copies uv 0.11.32 from its official image. It copies pyproject.toml and uv.lock first, installs runtime dependencies, then copies the application and migrations. Separating these layers lets Docker reuse dependency installation when only application code changes.

```dockerfile
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
RUN uv sync --locked --no-dev --no-install-project
USER appuser
```

The image has its own Linux environment at /opt/venv. Development tools are omitted. The process runs as appuser rather than root. The build context excludes local secrets, the Windows virtual environment, uploaded files and caches. LiveKit services will be added during the calling stage.

## The three services

The db service runs PostgreSQL 16 and stores data in the postgres_data volume. Its pg_isready health check determines when PostgreSQL can accept connections. Host access is bound to 127.0.0.1:55432; other Compose services connect to db:5432.

The migrate service uses the backend image and runs python -m alembic upgrade head. It waits for a healthy database, then exits. A successful exit is expected. A failed migration blocks dependent API startup instead of letting the application serve against the wrong schema.

The api service waits for db to be healthy and migrate to complete successfully. It publishes 127.0.0.1:8000 and uses /health/ready as its health check. The uploads volume prepares persistent storage for the later image upload feature; no upload endpoint exists yet.

```powershell
docker compose up --build -d
docker compose ps -a
docker compose logs --tail=50 api migrate
docker compose down
```

The final command stops the containers while preserving named volumes. Changing POSTGRES_PASSWORD in .env does not automatically alter credentials in an existing data volume. Keep custom credentials and both connection URLs consistent.

## Local development with the same database

You may keep PostgreSQL in Docker and run a reloadable development API through uv on a second port:

```powershell
uv run --directory backend uvicorn app.main:app `
    --reload --host 127.0.0.1 --port 8001
```

Use http://localhost:8001/docs for that process. The default bindings in this stage are for local development. Phone access and media networking will be configured when the mobile and calling stages are implemented.

<!-- pagebreak -->

## 6 Verification and the next stage

The complete suite passed 15 tests. Health tests check independent liveness, current/missing/outdated revisions, database error privacy, browser preflight behavior and documentation availability. Setup tests check invalid security settings and confirm that generated environment files have matching credentials and are never overwritten.

PostgreSQL tests create a unique lc_test_ schema for each test. They apply the migration, compare it with model metadata, downgrade the isolated schema, reapply it and inspect the result. Separate cases verify rejected duplicate emails, invalid roles, self-blocks, invalid conversations, nonpositive prices or areas, and out-of-range coordinates. Cleanup drops only the test's newly created schema.

## Run the checks yourself

```powershell
uv run --directory backend python -m pytest -q
uv run --project backend ruff check backend scripts
uv run --project backend ruff format --check backend scripts
```

The first command runs unit tests and skips two PostgreSQL tests unless TEST_POSTGRES_URL is provided. The README includes a command that loads the development URL from settings and enables those integration checks without printing credentials. The database user must be able to create schemas.

The test stack emits one upstream warning that Starlette's HTTPX integration is deprecated. All assertions passed; that warning is not suppressed. Ruff lint and formatting checks passed. The Docker image built successfully. Compose reported the API and database as healthy, and migrate exited with code 0. Both live health endpoints and /docs returned 200. The API container runs as user ID 10001.

## What to implement after you say next

The next checkpoint is registration, login and roles. It will add request and response schemas, Argon2 password hashing, JWT creation and validation, current-user lookup and authorization dependencies. It will include tests for login failures, invalid tokens and buyer versus seller/broker permissions.

Property management, browsing, image uploads, map queries, messages, meeting rooms and audio/video call flows will follow in later checkpoints. The initial tables support that plan but their API behavior is not yet implemented. The React Native interface and the final two-device calling demonstration also remain pending.

## Official references

uv project environments and Docker integration
https://docs.astral.sh/uv/guides/integration/docker/

Docker Compose startup conditions
https://docs.docker.com/compose/how-tos/startup-order/

FastAPI lifespan and tests
https://fastapi.tiangolo.com/advanced/events/

Alembic schema comparison and migration review
https://alembic.sqlalchemy.org/en/latest/autogenerate.html
