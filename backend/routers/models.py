import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request, UploadFile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/models", tags=["models"])

HOSTED_MODE_MESSAGE = (
    "Model uploads and activation are disabled on the free hosted DSP service. "
    "Use a local installation with your own trusted model files."
)


def _require_model_management(request: Request) -> None:
    """Keep untrusted public users from writing checkpoints to hosted storage."""
    if request.app.state.hosted_dsp_only:
        raise HTTPException(status_code=403, detail=HOSTED_MODE_MESSAGE)


def _get_manager(request: Request):
    """Retrieve the ModelManager instance from app state."""
    manager = getattr(request.app.state, "model_manager", None)
    if manager is None:
        raise HTTPException(status_code=503, detail="Model manager not initialized")
    return manager


@router.get("/")
async def list_models(request: Request) -> list[dict]:
    """List all available models with metadata."""
    manager = _get_manager(request)
    return await asyncio.to_thread(manager.list_models)


@router.post("/upload")
async def upload_model(request: Request, file: UploadFile) -> dict:
    """Upload a new model file (.onnx or .pth)."""
    _require_model_management(request)
    manager = _get_manager(request)

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    try:
        meta = await manager.upload_model(file.filename, file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        logger.exception("Upload failed")
        raise HTTPException(status_code=500, detail="Upload failed")

    return meta


@router.delete("/{name}")
async def delete_model(request: Request, name: str) -> dict:
    """Delete a model by name."""
    _require_model_management(request)
    manager = _get_manager(request)

    try:
        await asyncio.to_thread(manager.delete_model, name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Model not found: {name}")
    except Exception:
        logger.exception("Delete failed")
        raise HTTPException(status_code=500, detail="Delete failed")

    return {"status": "deleted", "name": name}


@router.post("/{name}/activate")
async def activate_model(request: Request, name: str) -> dict:
    """Activate a model for voice conversion."""
    _require_model_management(request)
    manager = _get_manager(request)

    try:
        result = await asyncio.to_thread(manager.activate_model, name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Model not found: {name}")
    except RuntimeError:
        # Model loader errors may include local filesystem paths, runtime
        # details, or checkpoint internals. Keep diagnostics in server logs.
        logger.exception("Model activation failed for %s", name)
        raise HTTPException(
            status_code=500,
            detail="Model activation failed. Check the server logs for details.",
        )

    return result


@router.post("/deactivate")
async def deactivate_model(request: Request) -> dict:
    """Deactivate the currently active model."""
    _require_model_management(request)
    manager = _get_manager(request)
    await asyncio.to_thread(manager.deactivate_model)
    return {"status": "deactivated"}


@router.get("/active")
async def get_active_model(request: Request) -> dict:
    """Get info about the currently active model."""
    manager = _get_manager(request)
    active = await asyncio.to_thread(manager.get_active_model)
    if active is None:
        return {"active": False}
    return active
