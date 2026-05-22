from fastapi import APIRouter

from src.admin.handlers.api.v1.router import router as admin_router
from src.audit_log.handlers.api.v1.router import router as audit_log_router
from src.auth.handlers.api.v1.router import router as auth_router
from src.bonus_transaction.handlers.api.v1.router import router as bonus_transaction_router
from src.brand.handlers.api.v1.router import router as brand_router
from src.notification.handlers.api.v1.router import router as notification_router
from src.payout_request.handlers.api.v1.router import router as payout_request_router
from src.promotion.handlers.api.v1.router import router as promotion_router
from src.receipt.handlers.api.v1.router import router as receipt_router
from src.seller.handlers.api.v1.router import router as seller_router
from src.sku.handlers.api.v1.router import router as sku_router
from src.app.settings import Settings

settings = Settings()

router = APIRouter(prefix=settings.PATH_PREFIX)
router.include_router(auth_router)
router.include_router(brand_router)
router.include_router(seller_router)
router.include_router(admin_router)
router.include_router(sku_router)
router.include_router(promotion_router)
router.include_router(receipt_router)
router.include_router(bonus_transaction_router)
router.include_router(payout_request_router)
router.include_router(notification_router)
router.include_router(audit_log_router)
