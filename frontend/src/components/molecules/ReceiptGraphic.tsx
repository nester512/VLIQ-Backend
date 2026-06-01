import type { Receipt } from '@/types/models'

interface ReceiptGraphicProps {
  receipt: Receipt
}

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n)
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function ReceiptGraphic({ receipt }: ReceiptGraphicProps) {
  return (
    <div
      className="bg-[#fdfdfb] rounded-[5px] px-[17px] py-4 text-[#1a1a1a] font-sans w-[230px]"
      style={{
        boxShadow: '0 14px 30px -10px rgba(0,0,0,0.4)',
        WebkitMaskImage: 'radial-gradient(5px at 5px 50%, transparent 98%, #000) -5px 0 / 100% 11px',
      }}
    >
      <h4 className="text-[13px] font-extrabold text-center tracking-[0.5px]">
        {receipt.shop_name ?? 'Магазин'}
      </h4>
      <div className="text-[8.5px] text-center text-[#555] mt-0.5 leading-[1.5]">
        Чек #{receipt.id}
      </div>
      <hr className="border-0 border-t border-dashed border-[#bbb] my-2" />
      {receipt.items?.map((item, i) => (
        <div key={i} className="flex justify-between text-[9px] my-[3px]">
          <span>{item.name}</span>
          <span>{fmt(item.price)} ₽</span>
        </div>
      ))}
      <hr className="border-0 border-t border-dashed border-[#bbb] my-2" />
      <div className="flex justify-between text-[12px] font-extrabold mt-[5px]">
        <span>ИТОГ</span>
        <span>{receipt.amount != null ? fmt(receipt.amount) : '—'} ₽</span>
      </div>
      <div className="text-[8.5px] text-center text-[#555] mt-[7px] leading-[1.5]">
        {formatDate(receipt.created_at)}
      </div>
      {/* QR placeholder */}
      <div
        className="w-[62px] h-[62px] mx-auto mt-2 rounded-[3px]"
        style={{
          background: `conic-gradient(#000 90deg, #fff 0 180deg, #000 0 270deg, #fff 0),
            repeating-linear-gradient(0deg, #000 0 4px, #fff 0 8px)`,
          backgroundBlendMode: 'difference',
        }}
        aria-hidden
      />
      <div className="text-[8.5px] text-center text-[#555] mt-1.5">Спасибо за покупку!</div>
    </div>
  )
}
