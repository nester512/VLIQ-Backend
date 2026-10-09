import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/atoms/Icon'

const TIPS: Array<[string, string]> = [
  ['Свайп вправо или «Одобрить»', 'чек одобрен, бонус начислен (если бонус не назначен — спросим сумму)'],
  ['Свайп влево или «Отклонить»', 'отклонить с причиной — продавец получит уведомление'],
  ['Свайп вниз или «Пропустить»', 'решить позже: чек уходит в конец колоды, на сервере ничего не меняется'],
  ['Тап по карточке или «Подробнее»', 'фото/PDF, товары, фискальные данные, история проверки в ОФД'],
  ['Имя продавца', 'страница продавца: статистика, риск и все его чеки'],
  ['«Возможный дубль» и красные метки', 'сигналы риска: повтор чека, чек другого продавца, старше 30 дней, сумма не совпала с ОФД'],
  ['Статус ОФД', '«Подтверждён» — налоговая знает этот чек; «повтор по расписанию» — проверка ещё идёт'],
  ['Счётчик справа', 'какой чек из общего числа ожидающих проверки'],
]

/** «ⓘ» next to the deck title: every hint in one place instead of on the cards. */
export function ReviewHelp() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="vliq-review-help__btn"
        aria-label="Как проверять чеки"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>i</span>
      </button>
      {open && (
        <div ref={panelRef} role="dialog" aria-label="Как проверять чеки" tabIndex={-1} className="vliq-review-help__panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <b style={{ fontSize: 15 }}>Как проверять чеки</b>
            <button type="button" aria-label="Закрыть" className="vliq-review-help__close" onClick={() => setOpen(false)}>
              <Icon name="x" size={16} />
            </button>
          </div>
          <ul>
            {TIPS.map(([what, how]) => (
              <li key={what}>
                <b>{what}</b> — {how}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
