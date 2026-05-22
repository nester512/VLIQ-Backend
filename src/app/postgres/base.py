from datetime import datetime

from sqlalchemy import TIMESTAMP, MetaData, func
from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    declarative_mixin,
    declared_attr,
    mapped_column,
    registry,
)

from src.app.postgres.intpk import intpk

DEFAULT_SCHEMA = "vliq"

POSTGRES_INDEXES_NAMING_CONVENTION = {
    "ix": "%(column_0_label)s_idx",
    "uq": "%(table_name)s_%(column_0_name)s_key",
    "ck": "%(table_name)s_%(constraint_name)s_check",
    "fk": "%(table_name)s_%(column_0_name)s_fkey",
    "pk": "%(table_name)s_pkey",
}

mapper_registry = registry(
    metadata=MetaData(naming_convention=POSTGRES_INDEXES_NAMING_CONVENTION),
)


class BaseModel(DeclarativeBase, AsyncAttrs):
    registry = mapper_registry
    metadata = mapper_registry.metadata


class CreateTableNameMixin:
    @declared_attr.directive
    def __tablename__(self) -> str:
        return self.__name__.lower()


@declarative_mixin
class ModelDumpMixin:
    def model_dump(self) -> dict:
        return {column.name: getattr(self, column.name) for column in self.__table__.columns}


class IDModel(BaseModel, CreateTableNameMixin, ModelDumpMixin):
    __abstract__ = True

    id: Mapped[intpk]


class TimeStampedModel(IDModel):
    __abstract__ = True

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.current_timestamp(),
    )

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}(id={self.id})>"
