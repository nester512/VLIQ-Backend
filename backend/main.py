"""Entry-point shim. The real FastAPI app lives at src.app.main:app."""
from src.app.main import app  # noqa: F401

if __name__ == "__main__":
    import uvicorn
    from src.app.settings import Settings

    uvicorn.run(app, host="0.0.0.0", port=Settings().port)
