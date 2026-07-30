"""Add the network outlet count to seller profiles.

The registration form collects the number of retail outlets in a seller's
network. Existing sellers remain valid: the column is nullable because they
were registered before this field existed. New registrations validate 1..1000
through ``SellerUpdate``.

Revision ID: 0008_seller_outlet_count
Revises: 0007_seed_all_cities
Create Date: 2026-07-30 00:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0008_seller_outlet_count"
down_revision: str | None = "0007_seed_all_cities"
branch_labels: str | None = None
depends_on: str | None = None

SCHEMA = "vliq"


def upgrade() -> None:
    op.add_column("seller", sa.Column("outlet_count", sa.Integer(), nullable=True), schema=SCHEMA)


def downgrade() -> None:
    op.drop_column("seller", "outlet_count", schema=SCHEMA)
