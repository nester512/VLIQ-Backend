type StepStatus = 'done' | 'active' | 'pending'

export interface TimelineStep {
  label: string
  subtitle?: string
  status: StepStatus
}

interface TimelineProps {
  steps: TimelineStep[]
}

function DotIcon({ status }: { status: StepStatus }) {
  if (status === 'done' || status === 'active') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5 10 17.5 19.5 7" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="10" height="10">
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  )
}

const dotStyle: Record<StepStatus, string> = {
  done: 'bg-[var(--vliq-ok-bg)] text-[var(--vliq-ok-ink)]',
  active: 'bg-[var(--vliq-wn-bg)] text-[var(--vliq-wn-ink)]',
  pending: 'bg-[var(--vliq-field)] text-[var(--vliq-hint)]',
}

export function Timeline({ steps }: TimelineProps) {
  return (
    <div className="py-1.5 px-1">
      {steps.map((step, i) => (
        <div key={step.label} className="flex gap-3.5 relative pb-[22px] last:pb-0">
          {/* Connector line */}
          {i < steps.length - 1 && (
            <div
              className="absolute left-[12.5px] top-[26px] bottom-0 w-0.5 bg-[var(--vliq-sep)]"
              aria-hidden
            />
          )}
          {/* Dot */}
          <div
            className={`w-[26px] h-[26px] rounded-full grid place-items-center flex-none z-10 ${dotStyle[step.status]}`}
          >
            <DotIcon status={step.status} />
          </div>
          {/* Text */}
          <div>
            <b
              className={`text-[14.5px] font-bold ${step.status === 'pending' ? 'text-[var(--vliq-hint)]' : ''}`}
            >
              {step.label}
            </b>
            {step.subtitle && (
              <span className="block text-[12px] text-[var(--vliq-hint)] font-medium mt-0.5">
                {step.subtitle}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
