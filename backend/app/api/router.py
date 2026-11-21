from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.conversations import router as conversations_router
from app.api.routes.health import router as health_router
from app.api.routes.listings import router as listings_router
from app.api.routes.users import router as users_router
from app.api.routes.websocket import router as websocket_router

router = APIRouter()
router.include_router(health_router)
router.include_router(auth_router)
router.include_router(users_router)
router.include_router(listings_router)
router.include_router(conversations_router)
router.include_router(websocket_router)
