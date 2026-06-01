"""Add vliq.city reference table + seed default cities.

City is the source of truth for the seller registration form: the frontend
renders the city dropdown from ``GET /cities`` and the backend validates that a
submitted ``seller.city`` belongs to the (active) dictionary.

Defaults seed three cities; further cities are managed directly in the DB / admin.

Revision ID: 0004_city_table
Revises: 0003_admin_table
Create Date: 2026-06-01 00:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004_city_table"
down_revision: str | None = "0003_admin_table"
branch_labels: str | None = None
depends_on: str | None = None

SCHEMA = "vliq"


def upgrade() -> None:
    op.create_table(
        "city",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("region", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("1000")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="city_pkey"),
        sa.UniqueConstraint("name", name="city_name_key"),
        schema=SCHEMA,
    )
    op.create_index("vliq_city_name_idx", "city", ["name"], schema=SCHEMA)
    op.create_index("vliq_city_is_active_idx", "city", ["is_active"], schema=SCHEMA)

    # Seed the default cities (idempotent). Extend via DB / admin later.
    op.execute(
        f"""
        INSERT INTO {SCHEMA}.city (name, region, is_active, sort_order, created_at, updated_at)
        VALUES
            ('Воронеж',      'Воронежская',  TRUE, 10, NOW(), NOW()),
            ('Москва',       'Москва',       TRUE, 20, NOW(), NOW()),
            ('Екатеринбург', 'Свердловская', TRUE, 30, NOW(), NOW())
        ON CONFLICT (name) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index("vliq_city_is_active_idx", table_name="city", schema=SCHEMA)
    op.drop_index("vliq_city_name_idx", table_name="city", schema=SCHEMA)
    op.drop_table("city", schema=SCHEMA)
