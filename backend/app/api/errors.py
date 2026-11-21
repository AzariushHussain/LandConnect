from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.errors import ChatError


async def request_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    # Pydantic validation errors may include raw password input, even for SecretStr fields.
    errors = [
        {"type": error["type"], "loc": error["loc"], "msg": error["msg"]} for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": errors})


async def chat_error(_request: Request, exc: ChatError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": str(exc)},
        headers={"Cache-Control": "no-store"},
    )
