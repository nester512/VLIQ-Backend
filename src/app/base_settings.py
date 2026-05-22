from enum import Enum

from pydantic_settings import BaseSettings as PydanticBaseSettings


class Env(str, Enum):
    test = "test"
    local = "local"
    dev = "dev"
    qa = "qa"
    prod = "prod"


class Postgres(PydanticBaseSettings):
    POSTGRES_URL: str


class BaseSettings(PydanticBaseSettings):
    pass
