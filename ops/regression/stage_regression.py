"""Stage regression — the API rows of docs/testing/REGRESSION.md.

Runs INSIDE the stage backend container (the bot token never leaves it):

    docker exec -i vliq-backend python - < ops/regression/stage_regression.py

STAGE ONLY: refuses to run unless BASE points at the stage domain. Synthetic data only:
creates fresh sellers 7009xxxx for this run (+ uses the stage admin 70000091 and the
synthetic super_admin 70000099, which must exist in vliq.admin on the stage DB).
Prints `PASS|FAIL|SKIP <case-id> <evidence>` per check and a summary; never prints tokens.
Stdlib only; the optional DB evidence (outbox / ledger) uses the app's own asyncpg.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta

BASE = os.environ.get("REGRESSION_BASE", "https://test-nekuro.online/api/v1")
if "test-nekuro.online" not in BASE:
    sys.exit("refusing to run: not the stage stand")

ADMIN_ID, SUPER_ID = 70000091, 70000099
RUN = int(time.time()) % 1000
ID0 = 70090000 + RUN * 10
M, S1, S2, B, D, R, R2 = (ID0 + i for i in range(7))  # main, search×2, blocked, debt, recovery old/new
SFX = "".join("абвгдежзик"[int(c)] for c in f"{RUN:03d}")
FN = "9960440300712345"

results: list[tuple[str, str, str]] = []


def rec(status: str, case: str, evidence: str = "") -> None:
    results.append((status, case, evidence))
    print(f"{status} {case} {evidence}".rstrip(), flush=True)


def check(case: str, cond: object, evidence: str = "") -> bool:
    rec("PASS" if cond else "FAIL", case, evidence)
    return bool(cond)


# ---- HTTP ---------------------------------------------------------------------------------


def call(method: str, path: str, token: str | None = None, body: object = None, headers: dict | None = None):
    for attempt in range(4):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, method=method, data=data)
        req.add_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                payload = json.loads(raw) if raw else {}
            except ValueError:
                payload = {"raw": raw[:200].decode(errors="replace")}
            if e.code == 429 and attempt < 3:  # rate limit: wait it out, never a product failure
                print(f"  .. 429 on {method} {path}, waiting 65 s", flush=True)
                time.sleep(65)
                continue
            return e.code, payload
    return 429, {}


def code_of(b: dict) -> str | None:
    return b.get("code") if isinstance(b, dict) else None


def init_data(uid: int) -> str:
    p = {"auth_date": str(int(time.time())), "query_id": f"reg{uid}",
         "user": json.dumps({"id": uid, "first_name": "Regress"}, separators=(",", ":"))}
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(p.items()))
    secret = hmac.new(b"WebAppData", os.environ["TG_BOT_TOKEN"].encode(), hashlib.sha256).digest()
    p["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode(p)


def tma(uid: int) -> tuple[int, dict]:
    time.sleep(6.5)  # tma-verify: 10/minute per client address
    return call("POST", "/auth/tma-verify", body={"init_data": init_data(uid)})


def login(uid: int) -> str:
    st, b = tma(uid)
    if st != 200:
        raise SystemExit(f"login {uid} failed: {st} {code_of(b)}")
    return b["access_token"]


# ---- domain helpers -----------------------------------------------------------------------

_fd_seq = random.randint(1_000_000, 8_000_000)


def qr(token: str, *, fp_tail: str = "7", source: str = "telegram_scan", key: str | None = None, **over):
    global _fd_seq
    _fd_seq += 1
    t = (datetime.now(UTC) + timedelta(hours=2)).strftime("%Y%m%dT%H%M")  # MSK − 1 h
    body = {"brand_id": 1, "source": source, "fn": FN, "fd": str(_fd_seq), "t": t, "s": "1450.00", "n": 1,
            "fp": str(random.randint(10000, 99999)) + fp_tail, "idempotency_key": key or f"reg-{RUN}-{_fd_seq}"}
    body.update(over)
    time.sleep(3.2)  # /receipts/qr: 20/minute
    st, b = call("POST", "/receipts/qr", token, body)
    return st, b, body


def wait_status(admin: str, rid: int, want=("on_review",), tries: int = 40) -> dict:
    r: dict = {}
    for _ in range(tries):
        st, r = call("GET", f"/receipts/{rid}", admin)
        if st == 200 and r.get("status") in want and r.get("verification_status") not in ("pending", "in_progress"):
            return r
        time.sleep(1)
    return r


def journey(admin: str, rid: int) -> dict:
    return call("GET", f"/receipts/{rid}/journey", admin)[1]


def wait_journey(admin: str, rid: int, pred, tries: int = 40) -> dict:
    j: dict = {}
    for _ in range(tries):
        j = journey(admin, rid)
        if pred(j):
            return j
        time.sleep(1)
    return j


def kinds(j: dict) -> list[str]:
    return [e["kind"] for e in j.get("events", [])]


def new_receipt(seller: str, admin: str, **kw) -> int:
    st, b, _ = qr(seller, **kw)
    assert st == 202, (st, code_of(b))
    wait_status(admin, b["receipt_id"])
    return b["receipt_id"]


def approve(admin: str, rid: int, bonus: int) -> tuple[int, dict]:
    return call("POST", f"/receipts/{rid}/approve", admin, {"bonus_amount": bonus})


def bal(seller: str) -> dict:
    return call("GET", "/sellers/me/balance", seller)[1]


def payout(seller: str, amount: int, key: str, phone: str = "+7 999 000-00-01"):
    return call("POST", "/payout-requests", seller, {"amount": amount, "payout_kind": "sbp_phone", "phone": phone},
                {"Idempotency-Key": key})


def register(token: str, uid: int, first: str, last: str) -> dict:
    st, b = call("PATCH", "/sellers/me", token, {
        "first_name": first, "last_name": last, "phone_e164": f"+7999{str(uid)[-7:]}",
        "outlet_name": f"Тестовая точка {uid}", "outlet_count": 1,
    })
    assert st == 200 and b.get("status") == "active", (st, code_of(b), b.get("status"))
    return b


def page_all(admin: str, path: str, limit: int = 200) -> tuple[list[dict], int]:
    items, page, total = [], 1, 0
    sep = "&" if "?" in path else "?"
    while True:
        st, p = call("GET", f"{path}{sep}limit={limit}&page={page}", admin)
        assert st == 200, (path, st, code_of(p))
        items += p["items"]
        total = p["total"]
        if not p.get("has_more") or not p["items"]:
            return items, total
        page += 1


async def _db(sql: str, *args):
    import asyncpg  # the app's own driver — present in the backend image

    url = os.environ["POSTGRES__POSTGRES_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(url)
    try:
        return await conn.fetch(sql, *args)
    finally:
        await conn.close()


def db(sql: str, *args):
    import asyncio

    try:
        return asyncio.run(_db(sql, *args))
    except Exception as exc:  # noqa: BLE001
        print(f"  .. db evidence unavailable: {type(exc).__name__}", flush=True)
        return None


def metrics(url: str) -> str | None:
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.read().decode()
    except Exception:  # noqa: BLE001
        return None


# ===========================================================================================
def main() -> None:  # noqa: C901, PLR0915
    print(f"run={RUN} sellers {M}..{R2} base={BASE}", flush=True)
    admin = login(ADMIN_ID)
    sup = login(SUPER_ID)
    tok: dict[int, str] = {}
    for uid in (M, S1, S2, B, D, R):
        tok[uid] = login(uid)
        me = call("GET", "/sellers/me", tok[uid])[1]
        if me.get("status") != "pending" or me.get("first_name"):
            raise SystemExit(f"id {uid} already used by an earlier run — re-run (RUN changes every second)")
    register(tok[M], M, "Регресс", f"Основной{SFX}")
    register(tok[S1], S1, "Ксюша", f"Тестова{SFX}")
    register(tok[S2], S2, "Ксения", f"Пробная{SFX}")
    register(tok[B], B, "Блок", f"Блокова{SFX}")
    register(tok[D], D, "Долг", f"Должникова{SFX}")
    register(tok[R], R, "Восстан", f"Потерянная{SFX}")
    sm = tok[M]

    # ---- 1. QR intake ---------------------------------------------------------------------
    st, b, _ = qr(sm, fn="123")
    check("R-QR-2", st == 422 and b.get("code") == "QR_FN_INVALID" and (b.get("extra") or {}).get("field") == "fn",
          f"bad ФН → {st} {b.get('code')} extra={b.get('extra')}")
    st, b, _ = qr(sm, n=2)
    check("R-QR-2", st == 422 and b.get("code") == "QR_NOT_INCOME" and (b.get("extra") or {}).get("field") == "n",
          f"refund n=2 → {st} {b.get('code')} extra={b.get('extra')}")
    st, b, _ = qr(admin)
    check("R-QR-8", st == 403, f"admin POST /receipts/qr → {st} {b.get('code')}")

    src_receipts: dict[str, int] = {}
    first_body = None
    for src in ("telegram_scan", "camera_scan", "image_decode", "pdf_decode", "manual"):
        st, b, body = qr(sm, source=src)
        rid = b.get("receipt_id")
        if src == "telegram_scan":
            first_body = body
        r = wait_status(admin, rid) if rid else {}
        src_receipts[src] = rid
        check("R-QR-1", st == 202 and r.get("source") == src and r.get("status") == "on_review",
              f"{src}: {st} receipt #{rid} source={r.get('source')} status={r.get('status')} verified_by={r.get('verified_by')}")
    r1 = src_receipts["telegram_scan"]

    time.sleep(3.2)
    st, b = call("POST", "/receipts/qr", sm, first_body)
    check("R-QR-4", st == 202 and b.get("receipt_id") == r1, f"same idempotency_key → {st} receipt #{b.get('receipt_id')} (orig #{r1})")

    st, b, _ = qr(sm, **{k: first_body[k] for k in ("fn", "fd", "fp", "t", "s")}, key=f"reg-{RUN}-dup")
    dup = b.get("receipt_id")
    warn = [w["code"] for w in b.get("warnings", [])]
    rd = wait_status(admin, dup) if dup else {}
    sig = [s for s in rd.get("fraud_signals", []) if s.get("signal") == "historical_duplicate_fn_fd_fp"]
    check("R-QR-3", st == 202 and dup and dup != r1 and "POSSIBLE_DUPLICATE" in warn,
          f"same QR, new key → {st} #{dup} warnings={warn}")
    check("R-QR-3", bool(sig) and sig[0].get("duplicate_of_id") == r1,
          f"admin signal on #{dup}: {[(s.get('signal'), s.get('duplicate_of_id')) for s in rd.get('fraud_signals', [])]}")

    # ---- 2. Receipt journey -----------------------------------------------------------------
    j = wait_journey(admin, r1, lambda j: j.get("summary", {}).get("verification_status") == "verified")
    k = kinds(j)
    want = ["received", "validated", "sent_to_moderation", "check_round_started", "provider_checked", "verified"]
    pos = [k.index(w) if w in k else -1 for w in want]
    seqs = [e["seq"] for e in j.get("events", [])]
    check("R-J-1", -1 not in pos and pos == sorted(pos) and seqs == list(range(1, len(seqs) + 1))
          and j["summary"]["verified_by"] == "fake", f"#{r1} kinds={k} seq={seqs}")
    pcs = [e for e in j.get("events", []) if e["kind"] == "provider_checked"]
    c = (pcs[0].get("check") or {}) if pcs else {}
    check("R-J-2", bool(c.get("request")) and c.get("response") is not None and c.get("adapter_version")
          and c.get("round_no") == 1,
          f"provider_checked: request={bool(c.get('request'))} response={c.get('response') is not None} "
          f"adapter={c.get('adapter_version')} round={c.get('round_no')} trigger={c.get('trigger')}")

    late = new_receipt(sm, admin, fp_tail="0")
    j = wait_journey(admin, late, lambda j: "check_round_failed" in kinds(j))
    s = j.get("summary", {})
    check("R-J-3", s.get("verification_status") == "retrying" and s.get("next_check_at") and "check_round_failed" in kinds(j),
          f"#{late} ФП…0: status={s.get('verification_status')} next_check_at={s.get('next_check_at')} kinds={kinds(j)[-3:]}")

    st, b = call("POST", f"/receipts/{late}/verify", admin, {"provider": "fns"})
    check("R-J-4", st == 409 and b.get("code") == "CHECK_PROVIDER_UNAVAILABLE", f"verify at ФНС → {st} {b.get('code')}")
    st1, j = call("POST", f"/receipts/{late}/verify", admin, {})
    st2, j = call("POST", f"/receipts/{late}/verify", admin, {"provider": "fake"})
    checks = [e["check"] for e in j.get("events", []) if e["kind"] == "provider_checked" and e.get("check")]
    check("R-J-4", st1 == 200 and st2 == 200 and any(c["trigger"] == "admin" for c in checks)
          and j.get("summary", {}).get("verification_status") == "verified",
          f"verify now {st1}/{st2}; rounds={[(c['round_no'], c['trigger'], c['outcome']) for c in checks]} "
          f"status={j.get('summary', {}).get('verification_status')}")
    check("R-J-4", all("token" not in json.dumps(c.get("request") or {}).lower() for c in checks),
          "no provider token in stored requests")

    st_a = call("GET", f"/receipts/{r1}/journey", sm)[0]
    st_b = call("GET", "/check-providers", sm)[0]
    st_c = call("POST", f"/receipts/{r1}/verify", sm, {})[0]
    check("R-J-5", st_a == st_b == st_c == 403, f"seller: journey {st_a}, providers {st_b}, verify {st_c}")

    # ---- 3. Moderation: queue ----------------------------------------------------------------
    q, qtotal = page_all(admin, "/receipts?status=on_review&queue=true")
    keys = [(x["created_at"], x["id"]) for x in q]
    dash = call("GET", "/analytics/dashboard", admin)[1]
    check("R-M-1", keys == sorted(keys) and len(q) == qtotal == len({x["id"] for x in q}),
          f"queue FIFO over {len(q)} receipts (total={qtotal})")
    check("R-M-1", qtotal == dash.get("receipts_on_review"),
          f"«N / всего»: queue total={qtotal}, dashboard on_review={dash.get('receipts_on_review')}")
    nf, nftotal = page_all(admin, "/receipts?status=on_review&queue=true&sort=no_fiscal_first")
    grp = [0 if not (x.get("fn") and x.get("fd") and x.get("fp")) else 1 for x in nf]
    in_grp_ok = all(
        [(x["created_at"], x["id"]) for x, g in zip(nf, grp, strict=True) if g == want_g]
        == sorted((x["created_at"], x["id"]) for x, g in zip(nf, grp, strict=True) if g == want_g)
        for want_g in (0, 1)
    )
    check("R-M-2", grp == sorted(grp) and in_grp_ok and nftotal == qtotal,
          f"no_fiscal_first: {grp.count(0)} without ФН/ФД/ФП first, then {grp.count(1)}; within groups by time={in_grp_ok}")

    # ---- 5. Payouts + money-changing moderation (seller M) ----------------------------------
    r2, r3, r4 = src_receipts["camera_scan"], src_receipts["image_decode"], src_receipts["pdf_decode"]
    manual = src_receipts["manual"]
    for rid, bonus in ((r1, 200_000), (r2, 200_000), (r3, 400_000), (r4, 600_000)):
        st, b = approve(admin, rid, bonus)
        assert st == 200, ("approve", rid, st, code_of(b))

    st, b = payout(sm, 299_999, f"min-{RUN}-{M}")
    check("R-P-1", st == 422 and b.get("code") == "PAYOUT_BELOW_MINIMUM", f"2 999,99 ₽ → {st} {b.get('code')}")
    st, b = payout(sm, 300_000, f"land-{RUN}-{M}", phone="+7 495 123-45-67")
    check("R-P-1", st == 422 and b.get("code") == "PAYOUT_PHONE_INVALID", f"городской номер → {st} {b.get('code')}")

    b0 = bal(sm)
    mine0 = len(call("GET", "/payout-requests/me", sm)[1])
    st, p1 = payout(sm, 300_000, f"p1-{RUN}-{M}")
    st2, p1b = payout(sm, 300_000, f"p1-{RUN}-{M}")
    mine1 = len(call("GET", "/payout-requests/me", sm)[1])
    b1 = bal(sm)
    check("R-P-2", st == 201 and st2 in (200, 201) and p1b.get("id") == p1.get("id") and mine1 == mine0 + 1,
          f"#{p1.get('id')} {st}, retry → {st2} #{p1b.get('id')}; seller requests {mine0}→{mine1}")
    check("R-P-2", b1["available"] == b0["available"] - 300_000 and b1["on_hold"] == b0["on_hold"] + 300_000,
          f"available {b0['available']}→{b1['available']}, on_hold {b0['on_hold']}→{b1['on_hold']}")
    cov = call("GET", f"/payout-requests/{p1['id']}/receipts", admin)[1]
    check("R-P-3", [(c["receipt_id"], c["amount"]) for c in cov] == [(r1, 200_000), (r2, 100_000)],
          f"coverage {[(c['receipt_id'], c['amount'], c['bonus_amount']) for c in cov]} (oldest #{r1} full, #{r2} partial)")

    st, b = call("POST", f"/receipts/{r1}/reject", admin, {"comment": "регресс"})
    check("R-M-10", st == 409 and b.get("code") == "RECEIPT_IN_ACTIVE_PAYOUT", f"new payout: cancel #{r1} → {st} {b.get('code')}")
    st, b = call("DELETE", f"/receipts/{r1}", admin, {"reason": "регресс"})
    check("R-M-10", st == 409 and b.get("code") == "RECEIPT_IN_ACTIVE_PAYOUT", f"new payout: delete #{r1} → {st} {b.get('code')}")
    st, b = call("PATCH", f"/receipts/{r2}/bonus", admin, {"bonus_amount": 150_000, "reason": "регресс"})
    check("R-M-10", st == 409 and b.get("code") == "RECEIPT_IN_ACTIVE_PAYOUT", f"new payout: lower bonus #{r2} → {st} {b.get('code')}")
    st, tk = call("POST", f"/payout-requests/{p1['id']}/take", admin)
    check("R-P-4", st == 200 and tk.get("status") == "in_progress" and tk.get("taken_at"), f"take → {st} {tk.get('status')}")
    st, b = call("POST", f"/receipts/{r2}/reject", admin, {"comment": "регресс"})
    check("R-M-10", st == 409 and b.get("code") == "RECEIPT_IN_ACTIVE_PAYOUT", f"in_progress: cancel #{r2} → {st} {b.get('code')}")

    st, pd = call("POST", f"/payout-requests/{p1['id']}/approve", admin, {"external_txn_id": f"REG-{RUN}"})
    st2, pd2 = call("POST", f"/payout-requests/{p1['id']}/approve", admin, {})
    rs1 = call("GET", f"/receipts/{r1}", admin)[1].get("status")
    rs2 = call("GET", f"/receipts/{r2}", admin)[1].get("status")
    j1, j2 = journey(admin, r1), journey(admin, r2)
    k1 = kinds(j1)
    part = [e.get("data", {}).get("partial") for e in j2.get("events", []) if e["kind"] == "paid_out"]
    check("R-P-4", st == 200 and pd.get("status") == "paid" and pd.get("paid_at") and pd.get("external_txn_id") == f"REG-{RUN}"
          and st2 == 200 and pd2.get("status") == "paid",
          f"paid {st} paid_at={pd.get('paid_at')} txn={pd.get('external_txn_id')}; second «Выплачено» → {st2} {pd2.get('status')}")
    check("R-P-4", rs1 == "paid_out" and rs2 == "approved" and "included_in_payout" in k1 and k1[-1] == "paid_out"
          and part == [True],
          f"#{r1} {rs1} journey …{k1[-2:]}; #{r2} (partial) {rs2} paid_out.partial={part}")
    rows = db("select count(*) n from vliq.notification_outbox where recipient_id=$1 and template='payout.sent'", M)
    if rows is None:
        rec("SKIP", "R-P-4", "one notification: no DB access from the script")
    else:
        check("R-P-4", rows[0]["n"] == 1, f"payout.sent outbox rows for the seller = {rows[0]['n']} (after 2× «Выплачено»)")

    b2 = bal(sm)
    st, p2 = payout(sm, 300_000, f"p2-{RUN}-{M}")
    st, b = call("POST", f"/payout-requests/{p2['id']}/reject", admin, {"admin_comment": "  "})
    check("R-P-5", st == 422 and b.get("code") == "PAYOUT_REJECT_REASON_REQUIRED", f"reject w/o reason → {st} {b.get('code')}")
    st, b = call("POST", f"/payout-requests/{p2['id']}/reject", admin, {"admin_comment": "Регресс: неверные реквизиты"})
    b3 = bal(sm)
    mine = {x["id"]: x for x in call("GET", "/payout-requests/me", sm)[1]}
    check("R-P-5", st == 200 and b.get("status") == "rejected" and b.get("rejected_at") and b3["available"] == b2["available"]
          and mine.get(p2["id"], {}).get("admin_comment") == "Регресс: неверные реквизиты",
          f"rejected {st}; available {b2['available']}→{b3['available']}; seller sees reason="
          f"{mine.get(p2['id'], {}).get('admin_comment')!r}")

    call("PATCH", f"/receipts/{manual}/bonus", admin, {"bonus_amount": 150_000})
    undecided = [x for x in page_all(admin, f"/receipts?seller_id={M}")[0]
                 if x["status"] not in ("approved", "paid_out", "rejected")]
    exp_review = sum(x["bonus_amount"] for x in undecided)
    b4 = bal(sm)
    check("R-P-6", b4["on_hold"] == 0 and b4["on_review"] == exp_review and exp_review > 0,
          f"after paid+rejected: on_hold={b4['on_hold']}; on_review={b4['on_review']} vs Σ undecided bonuses={exp_review} "
          f"({len(undecided)} receipts)")
    check("R-P-6", b4["total_paid_out"] == b0["total_paid_out"] + 300_000,
          f"total_paid_out {b0['total_paid_out']}→{b4['total_paid_out']}")

    # R-M-8 bonus decrease / increase (approved #r3, no active payout)
    a0 = bal(sm)["available"]
    st, b = call("PATCH", f"/receipts/{r3}/bonus", admin, {"bonus_amount": 350_000})
    check("R-M-8", st == 422 and b.get("code") == "RECEIPT_CHANGE_REASON_REQUIRED", f"lower w/o reason → {st} {b.get('code')}")
    st, b = call("PATCH", f"/receipts/{r3}/bonus", admin, {"bonus_amount": 350_000, "reason": "Регресс: сумма бонуса"})
    a1 = bal(sm)["available"]
    check("R-M-8", st == 200 and a1 == a0 - 50_000, f"lower with reason → {st}; available {a0}→{a1}")
    st, b = call("PATCH", f"/receipts/{r3}/bonus", admin, {"bonus_amount": 380_000})
    a2 = bal(sm)["available"]
    check("R-M-8", st == 200 and a2 == a1 + 30_000, f"raise w/o reason → {st}; available {a1}→{a2}")

    # R-M-9 delete approved (#r3) and paid out (#r1)
    st, b = call("DELETE", f"/receipts/{r3}", admin)
    check("R-M-9", st == 422 and b.get("code") == "RECEIPT_CHANGE_REASON_REQUIRED", f"delete approved w/o reason → {st} {b.get('code')}")
    st, _ = call("DELETE", f"/receipts/{r3}", admin, {"reason": "Регресс: удаление одобренного"})
    a3 = bal(sm)["available"]
    st2, b = call("DELETE", f"/receipts/{r3}", admin, {"reason": "повтор"})
    check("R-M-9", st == 204 and a3 == a2 - 380_000 and st2 == 204,
          f"delete approved → {st}, available {a2}→{a3}; repeat → {st2} {b.get('code') if isinstance(b, dict) else ''}")
    st, b = call("DELETE", f"/receipts/{r1}", admin)
    check("R-M-9", st == 422, f"delete paid out w/o reason → {st} {b.get('code')}")
    st, _ = call("DELETE", f"/receipts/{r1}", admin, {"reason": "Регресс: удаление выплаченного"})
    a4 = bal(sm)["available"]
    check("R-M-9", st == 204 and a4 == a3 - 200_000, f"delete paid out → {st}, available {a3}→{a4}")

    # R-M-7 cancel approved (#r4)
    st, b = call("POST", f"/receipts/{r4}/reject", admin, {})
    check("R-M-7", st == 422 and b.get("code") == "RECEIPT_CHANGE_REASON_REQUIRED", f"cancel approved w/o reason → {st} {b.get('code')}")
    st, b = call("POST", f"/receipts/{r4}/reject", admin, {"comment": "Регресс: отмена одобренного"})
    a5 = bal(sm)["available"]
    check("R-M-7", st == 200 and a5 == a4 - 600_000, f"cancel approved with reason → {st}; available {a4}→{a5}")
    rows = db("select kind, amount, reason from vliq.bonus_transaction where source_type='receipt' and source_id = any($1::bigint[]) "
              "and kind='correction' order by id", [r1, r3, r4])
    if rows is None:
        rec("SKIP", "R-M-7", "ledger rows: no DB access")
    else:
        reasons = [r["reason"] for r in rows]
        check("R-M-7", len(rows) >= 4 and all("Регресс" in (x or "") or "Корректировка" in (x or "") for x in reasons)
              and any("отмена одобренного" in (x or "") for x in reasons),
              f"separate correction rows with reason: {[(r['amount'], (r['reason'] or '')[:40]) for r in rows]}")

    # R-M-7 cancel PAID OUT + R-P-10 debt (seller D)
    sd = tok[D]
    d1 = new_receipt(sd, admin)
    approve(admin, d1, 300_000)
    st, pdd = payout(sd, 300_000, f"d-{RUN}-{D}")
    call("POST", f"/payout-requests/{pdd['id']}/take", admin)
    call("POST", f"/payout-requests/{pdd['id']}/approve", admin, {})
    ds = call("GET", f"/receipts/{d1}", admin)[1].get("status")
    st, b = call("POST", f"/receipts/{d1}/reject", admin, {"comment": " "})
    check("R-M-7", ds == "paid_out" and st == 422 and b.get("code") == "RECEIPT_CHANGE_REASON_REQUIRED",
          f"cancel paid out (#{d1} {ds}) w/o reason → {st} {b.get('code')}")
    st, b = call("POST", f"/receipts/{d1}/reject", admin, {"comment": "Регресс: отмена выплаченного"})
    bd = bal(sd)
    check("R-P-10", st == 200 and bd["available"] == -300_000, f"cancel paid out → {st}; available={bd['available']} (debt)")
    st, b = payout(sd, 300_000, f"d2-{RUN}-{D}")
    check("R-P-10", st == 422 and b.get("code") == "PAYOUT_INSUFFICIENT_BALANCE", f"new payout in debt → {st} {b.get('code')}")

    # ---- R-P-7 / R-P-8 lists and totals ---------------------------------------------------
    sm_ = call("GET", "/payout-requests/summary", admin)[1]
    ltotal = call("GET", "/payout-requests?limit=1", admin)[1]["total"]
    by_status = {k: sm_[k]["count"] for k in ("new", "in_progress", "paid", "rejected") if k in sm_}
    check("R-P-7", sum(by_status.values()) == ltotal, f"Σ by status {by_status} = {sum(by_status.values())} vs list total {ltotal}")
    paid, _ = page_all(admin, "/payout-requests?status=paid")
    month0 = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    n_month = sum(1 for p in paid if p.get("paid_at") and datetime.fromisoformat(p["paid_at"]) >= month0)
    no_paid_at = sum(1 for p in paid if not p.get("paid_at"))
    check("R-P-7", sm_["paid_this_month"]["count"] == n_month,
          f"paid this month: summary={sm_['paid_this_month']['count']} vs by paid_at={n_month} (paid w/o paid_at: {no_paid_at})")
    desc = call("GET", "/payout-requests?limit=5&order=desc", admin)[1]["items"]
    asc = call("GET", "/payout-requests?limit=5&order=asc", admin)[1]["items"]
    pg2 = call("GET", "/payout-requests?limit=5&page=2", admin)[1]
    dk = [(p["created_at"], p["id"]) for p in desc]
    ak = [(p["created_at"], p["id"]) for p in asc]
    check("R-P-8", dk == sorted(dk, reverse=True) and ak == sorted(ak) and desc[0]["id"] != asc[0]["id"]
          and pg2.get("page") == 2 and len(pg2.get("items", [])) == 5 and pg2["items"][0]["created_at"] <= desc[-1]["created_at"]
          and all(p.get("created_at") for p in desc + asc),
          f"newest #{desc[0]['id']} / oldest #{asc[0]['id']}; page 2 → {len(pg2.get('items', []))} items, total={pg2.get('total')}")

    # ---- 4/5. Blocked seller (R-S-5, R-P-9, R-D-2) ------------------------------------------
    sb = tok[B]
    b_old = new_receipt(sb, admin)
    approve(admin, b_old, 700_000)
    b_rev = new_receipt(sb, admin)
    _, pb1 = payout(sb, 300_000, f"b1-{RUN}-{B}")
    call("POST", f"/payout-requests/{pb1['id']}/take", admin)
    _, pb2 = payout(sb, 300_000, f"b2-{RUN}-{B}")
    blocked = False
    try:
        st, _ = call("POST", f"/sellers/{B}/block", admin, {"reason": "Регресс: блокировка"})
        blocked = st == 200
        assert blocked, ("block", st)
        q_ids = {x["id"] for x in page_all(admin, f"/receipts?status=on_review&queue=true&seller_id={B}")[0]}
        dash = call("GET", "/analytics/dashboard", admin)[1]
        qt = call("GET", "/receipts?status=on_review&queue=true&limit=1", admin)[1]["total"]
        hist = {x["id"] for x in page_all(admin, f"/receipts?seller_id={B}&order=desc")[0]}
        st, b = approve(admin, b_rev, 100_000)
        check("R-S-5", not q_ids and b_rev in hist and b_old in hist, f"queue has {len(q_ids)} of his receipts; history keeps #{b_old}, #{b_rev}")
        check("R-S-5", st == 409 and b.get("code") == "RECEIPT_SELLER_BLOCKED", f"approve opened card #{b_rev} → {st} {b.get('code')}")
        check("R-D-2", dash["receipts_on_review"] == qt, f"«На проверке» {dash['receipts_on_review']} = queue w/o blocked {qt}")
        lst = {p["id"] for p in page_all(admin, f"/payout-requests?seller_id={B}")[0]}
        only = {p["id"] for p in page_all(admin, f"/payout-requests?seller_id={B}&blocked=only")[0]}
        active_total = sum(call("GET", f"/payout-requests?status={s}&limit=1", admin)[1]["total"] for s in ("new", "in_progress"))
        summ = call("GET", "/payout-requests/summary", admin)[1]
        check("R-P-9", pb1["id"] not in lst and pb2["id"] not in lst and {pb1["id"], pb2["id"]} <= only,
              f"main list w/o #{pb1['id']},#{pb2['id']}; blocked=only has them")
        check("R-P-9", summ["blocked_in_progress"]["count"] >= 2, f"плашка «Заблокированные»: {summ['blocked_in_progress']}")
        check("R-D-2", dash["payouts_pending"] == active_total,
              f"«К выплате» {dash['payouts_pending']} = new+in_progress w/o blocked {active_total}")
        st, b = call("POST", f"/payout-requests/{pb1['id']}/approve", admin, {})
        check("R-P-9", st == 409 and b.get("code") == "PAYOUT_SELLER_BLOCKED", f"«Выплачено» #{pb1['id']} → {st} {b.get('code')}")
        st, b = call("POST", f"/payout-requests/{pb2['id']}/reject", admin, {"admin_comment": "Регресс: продавец заблокирован"})
        check("R-P-9", st == 200 and b.get("status") == "rejected", f"«Отклонить» #{pb2['id']} → {st} {b.get('status')}")
    finally:
        if blocked:
            st, _ = call("POST", f"/sellers/{B}/unblock", admin)
            print(f"  .. unblock {B} → {st}", flush=True)
    q_ids = {x["id"] for x in page_all(admin, f"/receipts?status=on_review&queue=true&seller_id={B}")[0]}
    lst = {p["id"] for p in page_all(admin, f"/payout-requests?seller_id={B}")[0]}
    st, b = call("POST", f"/payout-requests/{pb1['id']}/approve", admin, {})
    check("R-S-5", b_rev in q_ids, f"after unblock #{b_rev} back in queue")
    check("R-P-9", pb1["id"] in lst and st == 200 and b.get("status") == "paid", f"after unblock #{pb1['id']} listed, «Выплачено» → {st}")

    # ---- 4. Sellers: search, card, lists ----------------------------------------------------
    def found(term: str, extra: str = "") -> tuple[set[int], int]:
        st, p = call("GET", f"/sellers?limit=200&search={urllib.parse.quote(term)}{extra}", admin)
        return {x["telegram_id"] for x in p.get("items", [])}, p.get("total", -1)

    sur1, sur2 = f"Тестова{SFX}", f"Пробная{SFX}"
    cases = [
        ("Имя Фамилия", f"Ксюша {sur1}", {S1}, {S2}),
        ("Фамилия Имя", f"{sur1} Ксюша", {S1}, {S2}),
        ("часть", sur1[2:-1], {S1}, {S2}),
        ("регистр", f"кСЮША {sur1.upper()}", {S1}, {S2}),
        ("пробелы", f"   Ксюша    {sur1}  ", {S1}, {S2}),
        ("второй", f"ксения {sur2.lower()}", {S2}, {S1}),
        ("общая часть фамилий", SFX, {S1, S2}, set()),
    ]
    for label, term, must, mustnt in cases:
        ids, total = found(term)
        check("R-S-1", must <= ids and not (mustnt & ids), f"{label} «{term.strip()}» → total={total}")
    ids, total = found(f"Ксюша {sur2}")
    check("R-S-1", total == 0, f"no match «Ксюша {sur2}» → total={total} («Ничего не нашли»)")
    ids_a, _ = found(sur1, "&status=active")
    ids_b, tb = found(sur1, "&status=blocked")
    check("R-S-1", S1 in ids_a and S1 not in ids_b and tb == 0, f"with status: active has him, blocked total={tb}")

    st, c0 = call("GET", f"/sellers/{S1}", admin)
    nums = ("balance_available", "receipts_total", "total_accrued", "total_paid_out", "on_hold")
    check("R-S-2", st == 200 and all(isinstance(c0.get(k), int) and c0.get(k) == 0 for k in nums),
          f"empty seller card: {{{', '.join(f'{k}={c0.get(k)!r}' for k in nums)}}}")
    st, cm = call("GET", f"/sellers/{M}", admin)
    hist_total = call("GET", f"/receipts?seller_id={M}&limit=1", admin)[1]["total"]
    check("R-S-2", cm.get("balance_available") == bal(sm)["available"] and cm.get("receipts_total") == hist_total,
          f"seller #{M}: balance {cm.get('balance_available')} = /me/balance; «Чеков всего» {cm.get('receipts_total')} vs history {hist_total}")

    for sort in ("created_at:desc", "created_at:asc", "updated_at:desc", "last_receipt_at:desc", "receipts_total:desc",
                 "receipts_30d:desc", "receipts_approved:desc", "risk_score:desc", "name:asc", "name:desc"):
        items, total = page_all(admin, f"/sellers?sort={sort}", limit=173)
        ids = [x["telegram_id"] for x in items]
        field, _, d = sort.partition(":")
        mono = True
        if field in ("receipts_total", "receipts_30d", "receipts_approved", "risk_score"):
            vals = [x["stats"][field] for x in items]
            mono = vals == sorted(vals, reverse=d == "desc")
        check("R-S-4", len(ids) == total == len(set(ids)) and mono, f"sort {sort}: {len(ids)} rows / total {total}, unique, ordered={mono}")
    for flt in ("status=active", "has_on_review=true", "risk=high", "status=pending"):
        items, total = page_all(admin, f"/sellers?{flt}&sort=receipts_total:desc", limit=97)
        ids = [x["telegram_id"] for x in items]
        check("R-S-4", len(ids) == total == len(set(ids)), f"filter {flt}: {len(ids)} rows / total {total}, unique")

    # ---- 8. Dashboard top ---------------------------------------------------------------------
    top = call("GET", "/analytics/dashboard", admin)[1].get("top_sellers", [])
    tk_ = [(-t["total_accrued"], -t["receipts_approved"], t["telegram_id"]) for t in top]
    card = call("GET", f"/sellers/{top[0]['telegram_id']}", admin)[1] if top else {}
    check("R-D-1", top and tk_ == sorted(tk_) and card.get("total_accrued") == top[0]["total_accrued"],
          f"{len(top)} rows by accrued↓/approved↓/id; #1 {top[0]['telegram_id'] if top else None} accrued="
          f"{top[0]['total_accrued'] if top else None} = card {card.get('total_accrued')}")

    # ---- 9. Account recovery ------------------------------------------------------------------
    body = {"new_telegram_id": R2, "reason": "Регресс: звонок на номер анкеты + фото документа"}
    st_s = call("POST", f"/sellers/{R}/transfer-login", sm, body)[0]
    st_a, ba = call("POST", f"/sellers/{R}/transfer-login", admin, body)
    check("R-A-1", st_s == 403 and st_a == 403, f"seller → {st_s}; admin → {st_a} {ba.get('code')}")
    sr = tok[R]
    rr = new_receipt(sr, admin)
    approve(admin, rr, 250_000)
    exists = call("GET", f"/sellers/{R2}", admin)[0]
    st, b = call("POST", f"/sellers/{R}/transfer-login", sup, {**body, "reason": "коротко"})
    # < 10 chars is refused by the request schema (min_length=10) → VALIDATION_ERROR, before the
    # service could answer ACCOUNT_TRANSFER_REASON_REQUIRED; either way nothing is transferred.
    check("R-A-2", st == 422 and b.get("code") in ("VALIDATION_ERROR", "ACCOUNT_TRANSFER_REASON_REQUIRED"),
          f"short reason → {st} {b.get('code')}")
    st, b = call("POST", f"/sellers/{R}/transfer-login", sup, body)
    check("R-A-2", exists == 404 and st == 200 and b.get("already_linked") is False, f"super_admin transfer → {st} {b}")
    st_n, bn = tma(R2)
    new_tok = bn.get("access_token")
    me = call("GET", "/sellers/me", new_tok)[1] if new_tok else {}
    nb = bal(new_tok) if new_tok else {}
    nr = call("GET", "/sellers/me/receipts", new_tok)[1] if new_tok else {}
    check("R-A-2", st_n == 200 and bn.get("role") == "seller" and me.get("telegram_id") == R and nb.get("available") == 250_000
          and [x["id"] for x in nr.get("items", [])] == [rr],
          f"new account login {st_n} role={bn.get('role')} → seller #{me.get('telegram_id')}, available={nb.get('available')}, "
          f"receipts={[x['id'] for x in nr.get('items', [])]}")
    st_o, bo = tma(R)
    check("R-A-2", st_o == 403 and bo.get("code") == "ACCOUNT_MOVED", f"old account login → {st_o} {bo.get('code')}")
    au = call("GET", f"/audit-logs?action=transfer_seller_login&entity_id={R}", admin)[1].get("items", [])
    pl = (au[0].get("payload") or {}) if au else {}
    check("R-A-2", len(au) == 1 and pl.get("old_telegram_id") == R and pl.get("new_telegram_id") == R2 and au[0]["actor_id"] == SUPER_ID
          and au[0].get("comment") == body["reason"], f"audit rows={len(au)} payload={pl} actor={au[0]['actor_id'] if au else None}")
    st, b = call("POST", f"/sellers/{R}/transfer-login", sup, body)
    check("R-A-2", st == 200 and b.get("already_linked") is True, f"repeat → {st} already_linked={b.get('already_linked')}")

    # ---- 10. Worker metrics (inside the stage network) ----------------------------------------
    m1 = metrics("http://receipt-pipeline-worker:9101/metrics")
    fake_lines = [ln for ln in (m1 or "").splitlines() if ln.startswith("ofd_requests_total{") and 'provider="fake"' in ln]
    check("R-I-4", bool(fake_lines), f"pipeline :9101 ofd_requests_total fake: {fake_lines[:3] or ('unreachable' if m1 is None else 'absent')}")
    m2 = metrics("http://notifications-worker:9102/metrics")
    nl = [ln for ln in (m2 or "").splitlines() if ln.startswith(("notification_outbox_pending", "notification_outbox_dead"))]
    check("R-I-4", len(nl) == 2, f"notifications :9102: {nl or ('unreachable' if m2 is None else 'absent')}")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, SystemExit, Exception) as exc:  # noqa: BLE001
        rec("FAIL", "ABORT", f"{type(exc).__name__}: {exc}")
    n = {s: sum(1 for r in results if r[0] == s) for s in ("PASS", "FAIL", "SKIP")}
    failed = sorted({c for s, c, _ in results if s == "FAIL"})
    print(f"SUMMARY pass={n['PASS']} fail={n['FAIL']} skip={n['SKIP']} failed_cases={failed}")
