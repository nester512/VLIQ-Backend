import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from src.app.postgres.base import BaseModel

# Import every model so Alembic autogenerate sees them all in BaseModel.metadata.
from src.admin.models import Admin  # noqa: F401
from src.audit_log.models import AuditLog  # noqa: F401
from src.bonus_transaction.models import BonusTransaction  # noqa: F401
from src.brand.models import Brand  # noqa: F401
from src.notification.models import Notification  # noqa: F401
from src.payout_request.models import PayoutRequest  # noqa: F401
from src.promotion.models import Promotion  # noqa: F401
from src.receipt.models import Receipt  # noqa: F401
from src.seller.models import Seller  # noqa: F401
from src.sku.models import Sku  # noqa: F401


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", os.environ["POSTGRES__POSTGRES_URL"])

target_metadata = BaseModel.metadata


def include_object(object, name, type_, reflected, compare_to):
    # Only manage objects in the vliq schema.
    if type_ == "table" and object.schema != "vliq":
        return False
    return True


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
        include_object=include_object,
        version_table_schema="public",
        compare_type=True,  # B6: detect column type changes in autogenerate
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_schemas=True,
        include_object=include_object,
        version_table_schema="public",
        compare_type=True,  # B6: detect column type changes in autogenerate
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
