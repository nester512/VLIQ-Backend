import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Icon } from '@/components/atoms/Icon'

const FAQ_ITEMS = [
  {
    question: 'Какая сумма выплаты за единицу продукции?',
    answer: 'За каждую подтверждённую единицу продукции начисляется 20 рублей.',
  },
  {
    question: 'За какую продукцию VLIQ можно получить выплаты?',
    answer: 'Выплаты начисляются за продукцию бренда VLIQ из линеек MAX FLAVOR, SHOCK и HOLODNO PISEC.',
  },
  {
    question: 'Участвуют ли коллаборации в системе мотивации?',
    answer: 'Нет. В системе мотивации участвуют только актуальные линейки бренда VLIQ.',
  },
  {
    question: 'Какой срок выплаты средств?',
    answer: 'После одобрения чека выплата производится в течение 7 рабочих дней.',
  },
  {
    question: 'Какая минимальная сумма доступна для вывода?',
    answer: 'Минимальная сумма для вывода составляет 3 000 рублей.',
  },
  {
    question: 'Сколько времени занимает проверка чека?',
    answer: 'Мы проверяем чеки в порядке очереди и стараемся делать это максимально быстро. Средний срок проверки составляет 2–3 рабочих дня.',
  },
  {
    question: 'Можно ли работать в нескольких магазинах сети?',
    answer: 'Да. Регистрация одна, а чеки можно загружать из любых торговых точек сети, где вы работаете.',
  },
  {
    question: 'Почему торговая точка из регистрации не ограничивает работу?',
    answer: 'При регистрации вы указываете основную точку — она нужна для связи и статистики. Приём чеков к ней не привязан: чеки из других точек сети принимаются так же.',
  },
  {
    question: 'Можно ли изменить данные профиля?',
    answer: 'Регулярно менять ничего не нужно: реквизиты для выплаты вы вводите в каждой заявке заново, а основная точка не влияет на приём чеков. Если изменились имя или телефон — напишите в поддержку (Профиль → «Помощь»).',
  },
  {
    question: 'Влияет ли смена username в Telegram на вход?',
    answer: 'Нет. Вход привязан к вашему аккаунту Telegram, а не к имени пользователя — username можно менять, баланс и чеки останутся.',
  },
  {
    question: 'Что делать, если потерян доступ к аккаунту Telegram?',
    answer: 'Новый аккаунт Telegram — это новый вход: старые чеки и баланс он не увидит. Напишите в поддержку — после проверки личности сотрудник перенесёт доступ на новый аккаунт. Привязать новый аккаунт самостоятельно, только по номеру телефона, нельзя — так мы защищаем ваши деньги.',
  },
  {
    question: 'Есть ли ограничение на количество чеков на проверке?',
    answer: 'Нет, ограничения нет. Загружайте сколько нужно — все чеки сохраняются и будут проверены. В разделе «Чеки» видны все загруженные чеки, включая те, что ещё на проверке.',
  },
] as const

/** «Вопросы и ответы» — the same block on the home screen and in the profile. */
export function SellerFaq({ id = 'faq' }: { id?: string }) {
  const location = useLocation()
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  useEffect(() => {
    if (location.hash !== `#${id}`) return
    document.getElementById(id)?.scrollIntoView?.({ block: 'start' })
  }, [location.hash, id])

  return (
    <section id={id} aria-label="Вопросы и ответы" className="vliq-pad" style={{ paddingBottom: 24 }}>
      <div className="vliq-sec-t">
        <b>Вопросы и ответы</b>
      </div>
      <div className="vliq-list">
        {FAQ_ITEMS.map((item, index) => {
          const isOpen = openIndex === index
          return (
            <div key={item.question}>
              <button
                type="button"
                className="vliq-row"
                aria-expanded={isOpen}
                onClick={() => setOpenIndex((current) => current === index ? null : index)}
              >
                <div className="vliq-row-tx">
                  <b style={isOpen ? { whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip' } : undefined}>
                    {item.question}
                  </b>
                </div>
                <span aria-hidden style={{ flex: 'none', color: 'var(--vliq-hint)', display: 'inline-flex', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s ease' }}>
                  <Icon name="chev" size={18} />
                </span>
              </button>
              {isOpen && (
                <p style={{ margin: '0', padding: '0 48px 14px 16px', fontSize: 13, fontWeight: 500, lineHeight: 1.45, color: 'var(--vliq-hint)' }}>
                  {item.answer}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
