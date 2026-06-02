"""Single import point that registers ALL ORM models with the metadata.

SQLAlchemy resolves ForeignKey targets lazily — at flush time it walks the
metadata for the referenced table. If a model isn't imported anywhere before
the first flush touches its FK, you get `NoReferencedTableError`.

Importing this module from `src/app/main.py` guarantees every model class is
registered before any session does work.
"""

from __future__ import annotations

from src.admin import models as _admin  # noqa: F401
from src.audit_log import models as _audit  # noqa: F401
from src.bonus_transaction import models as _bt  # noqa: F401
from src.brand import models as _brand  # noqa: F401
from src.city import models as _city  # noqa: F401
from src.notification import models as _notif  # noqa: F401  # also registers NotificationOutbox
from src.payout_request import models as _payout  # noqa: F401
from src.promotion import models as _promo  # noqa: F401
from src.receipt import models as _receipt  # noqa: F401
from src.seller import models as _seller  # noqa: F401
from src.sku import models as _sku  # noqa: F401
