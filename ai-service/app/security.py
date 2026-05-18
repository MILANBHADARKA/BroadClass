"""
Internal-API-Key gate. Origin and System-Manager must present the shared
INTERNAL_API_KEY in the `X-Internal-Key` header. This is a service-to-service
trust boundary — students never see this key.
"""

from fastapi import Header, HTTPException, status

from .config import get_settings


async def require_internal_key(x_internal_key: str | None = Header(default=None)) -> None:
    settings = get_settings()
    if not x_internal_key or x_internal_key != settings.internal_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing X-Internal-Key",
        )
