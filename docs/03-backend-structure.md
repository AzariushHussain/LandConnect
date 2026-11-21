# LandConnect Backend Structure Guide

The backend now separates application assembly, HTTP routes, configuration, database infrastructure and models. Every entity has its own model file. This gives the next features clear locations while preserving the existing schema and health endpoint behavior.

## 1 Read the directory structure

```text
backend/
  app/
    main.py
    api/
      router.py
      routes/
        health.py
    core/
      config.py
    db/
      base.py
      session.py
    models/
      __init__.py
      common.py
      enums.py
      user.py
      block.py
      listing.py
      listing_image.py
      conversation.py
      message.py
      call.py
      meeting.py
      meeting_member.py
  alembic/
    env.py
    versions/
      0001_initial_initial_marketplace_schema.py
  tests/
    conftest.py
    unit/
      test_health.py
      test_setup.py
      test_model_registry.py
    integration/
      test_migrations.py
  pyproject.toml
  uv.lock
  Dockerfile
  alembic.ini
```

Package directories under app also contain __init__.py. The models package initializer has an additional job: it explicitly imports and exports every model. The runtime entry point remains app.main:app, so the uv and Docker startup commands remain the same.

<!-- pagebreak -->

## 2 Understand each responsibility

main.py assembles FastAPI, installs CORS middleware, manages application lifespan and includes the API router. Endpoint functions live in api/routes/health.py. api/router.py combines feature routers into one application router; future registration and listing routes can be added there.

core/config.py owns typed settings and cached configuration loading. Its .env lookup was adjusted for its new directory depth, preserving the root environment file. The corresponding container settings still come from Compose environment variables.

db/base.py defines the SQLAlchemy declarative base and metadata naming convention. It does not load settings or create an engine. db/session.py owns the runtime engine, session factory and request dependency. Separating these lets models and schema tooling work without importing runtime connection setup.

Each models file owns one entity and its table mapping. user.py contains User; listing.py contains Listing; listing_image.py contains ListingImage, and so on. All column definitions, indexes, constraints, defaults and relationship options were preserved. enums.py contains Role, ListingStatus, CallKind and CallStatus. common.py holds the existing timestamp and database enum helpers.

## Imports to use from now on

```python
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.models.user import User
from app.models.listing import Listing
from app.models.enums import Role
```

The public model exports also support from app.models import User, Listing, Role. Internal model files import Base from app.db.base, enums and helpers from their own modules, and avoid importing the package root while it is still being initialized.

Listing and Meeting use forward references for related classes. TYPE_CHECKING imports let editors understand those types without introducing runtime import cycles. SQLAlchemy resolves the related classes through the shared registry after all model modules have loaded.

## Why Alembic still sees every table

alembic/env.py imports Base through app.models. That executes models/__init__.py, registering all nine entity classes before Base.metadata is passed to Alembic. A bare import of app.db.base alone does not load the entities. Registering each new model in the package initializer is therefore part of adding a model.

Official reference for deferred relationships
https://docs.sqlalchemy.org/en/20/orm/basic_relationships.html#late-evaluation-of-relationship-arguments

<!-- pagebreak -->

## 3 Add the next feature consistently

For a new persistent entity, add its model module, import it in models/__init__.py and include its public name in __all__. Put related enum types in enums.py. Generate and review an Alembic revision only when the database schema changes.

For the upcoming authentication stage, request and response validation will go in app/schemas/auth.py, authentication behavior in app/services/auth.py and HTTP handlers in app/api/routes/auth.py. Those modules will be created when the feature is implemented. The route module will be registered in api/router.py. Keep database transactions with the behavior that owns the write; use the shared request session dependency.

Tests belong in tests/unit when they run without an external database, and tests/integration when they exercise PostgreSQL and migrations. Shared test environment setup remains in tests/conftest.py. The isolated schema fixture continues to protect the development tables during rollback tests.

## Checks performed for this refactor

All 16 tests passed, including the existing PostgreSQL migration and constraint checks. The added model-registry test starts a fresh Python process, imports the package, configures every mapper and verifies the Listing owner/images and Meeting members relationships. It also verifies that model imports do not load core configuration or the runtime session module.

Alembic reported no new upgrade operations against the current PostgreSQL database. No new migration was generated and the existing migration file was not changed. Ruff lint and formatting checks passed. The test stack continues to report its existing upstream HTTPX deprecation warning.

```powershell
uv run --project backend ruff check backend scripts
uv run --project backend ruff format --check backend scripts
uv run --directory backend python -m pytest -q
uv run --directory backend python -m alembic check
docker compose up --build -d
```

The plain pytest command skips the two PostgreSQL tests unless TEST_POSTGRES_URL is set. The README contains the complete-suite command with the new app.core.config import path.

## Scope of this checkpoint

This is the production-oriented project structure for the implemented foundation. A folder layout does not make the entire application production ready. Authentication, authorization, marketplace operations, messaging and audio/video behavior remain scheduled for their own stages. The current API documentation remains at http://localhost:8000/docs. Say next to implement registration, login and roles.
