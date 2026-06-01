from typing import Annotated

from sqlalchemy import BigInteger
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import mapped_column

BigIntegerType = BigInteger()
BigIntegerType = BigIntegerType.with_variant(postgresql.BIGINT(), "postgresql")
BigIntegerType = BigIntegerType.with_variant(sqlite.INTEGER(), "sqlite")

intpk = Annotated[
    int,
    mapped_column(BigIntegerType, primary_key=True, autoincrement=True),
]
