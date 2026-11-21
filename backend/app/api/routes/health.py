from pathlib import Path
from typing import Annotated

from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.realtime import get_chat
from app.db.session import get_db
from app.services.realtime import ChatHub

router = APIRouter(prefix="/health", tags=["Health"])
migration_heads = set(
    ScriptDirectory(str(Path(__file__).resolve().parents[3] / "alembic")).get_heads()
)


@router.get("/live")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
def readiness(
    db: Annotated[Session, Depends(get_db)], hub: Annotated[ChatHub, Depends(get_chat)]
) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1"))
        current_heads = set(MigrationContext.configure(db.connection()).get_current_heads())
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    if not migration_heads or current_heads != migration_heads:
        raise HTTPException(status_code=503, detail="Database migrations are pending")
    if not hub.ready:
        raise HTTPException(status_code=503, detail="Realtime broker unavailable")
    return {"status": "ready", "database": "ok", "migrations": "current", "redis": "ok"}
