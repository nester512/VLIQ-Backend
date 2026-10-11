"""Signed Telegram initData for SYNTHETIC stage accounts — UI regression only.

Runs inside the stage backend container (the bot token never leaves it):
    docker exec -i vliq-backend python - ADMIN_ID SELLER_ID < ops/regression/ui/sign_initdata.py > initdata.json
Refuses to run anywhere but the stage (CHECK_PROVIDER_STUB=true is set only by the stage overlay).
"""

import hashlib
import hmac
import json
import os
import sys
import time
import urllib.parse

if os.environ.get("CHECK_PROVIDER_STUB", "").lower() != "true":
    sys.exit("refused: not the stage (CHECK_PROVIDER_STUB is not true)")

TOKEN = os.environ["TG_BOT_TOKEN"]


def sign(uid: int, first: str) -> str:
    user = json.dumps({"id": uid, "first_name": first, "last_name": "UI", "language_code": "ru"}, separators=(",", ":"))
    fields = {"auth_date": str(int(time.time())), "query_id": "AAH", "user": user}
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    key = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(key, dcs.encode(), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode(fields)


admin_id, seller_id = int(sys.argv[1]), int(sys.argv[2])
print(json.dumps({"admin": sign(admin_id, "Админ"), "seller": sign(seller_id, "Продавец"), "seller_id": seller_id}))
