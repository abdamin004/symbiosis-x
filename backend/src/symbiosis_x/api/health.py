from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health/live", status_code=200)
def live() -> dict[str, str]:
    return {"status": "alive"}
