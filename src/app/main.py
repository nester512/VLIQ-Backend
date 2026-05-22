from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.app.api.v1 import router as v1_router
from src.app.settings import Settings

config = Settings()


def setup_middleware(app: FastAPI) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def setup_routers(app: FastAPI) -> None:
    app.include_router(v1_router)

    @app.get("/health")
    def get_health():
        return {"result": "ok"}


def create_app(*args, **kwargs) -> FastAPI:
    app = FastAPI(
        title="VLIQ Backend",
        description="Loyalty/bonus system — entity scaffold (no business logic yet)",
        docs_url="/swagger",
    )
    setup_middleware(app)
    setup_routers(app)
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=config.port)
