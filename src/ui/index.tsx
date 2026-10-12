import { useId, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, FolderOpen, Loader2, type LucideIcon } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'cta'

export function Button({
  variant = 'secondary', size = 'md', icon: Icon, loading, mascot, children, className = '', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon; loading?: boolean; mascot?: string }) {
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 18 : 16
  return (
    <button type="button" className={`btn btn--${variant} btn--${size} ${className}`} {...rest}>
      {mascot && <img className="btn__mascot" src={mascot} alt="" aria-hidden="true" />}
      {loading ? <Loader2 size={iconSize} className="spin" /> : Icon && <Icon size={iconSize} strokeWidth={2.1} />}
      {children}
    </button>
  )
}

export function IconButton({
  icon: Icon, label, tone, outlined, size = 16, className = '', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; tone?: 'danger' | 'accent'; outlined?: boolean; size?: number }) {
  return (
    <button type="button" aria-label={label} title={label}
      className={`icon-btn${outlined ? ' icon-btn--outlined' : ''}${tone ? ` icon-btn--${tone}` : ''} ${className}`} {...rest}>
      <Icon size={size} strokeWidth={2} />
    </button>
  )
}

export function Card({ title, subtitle, icon: Icon, actions, children, className = '', style }: {
  title?: ReactNode; subtitle?: ReactNode; icon?: LucideIcon; actions?: ReactNode; children?: ReactNode; className?: string; style?: CSSProperties
}) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || actions) && (
        <header className="card__head">
          {Icon && <span className="card__icon"><Icon size={17} strokeWidth={2.1} /></span>}
          <div className="card__titles">
            {title && <h2 className="card__title">{title}</h2>}
            {subtitle && <p className="card__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Field({ label, value, hint, hintTone, children, className = '' }: {
  label: ReactNode; value?: ReactNode; hint?: ReactNode; hintTone?: 'warn' | 'error'; children: ReactNode; className?: string
}) {
  return (
    // 使用 div 而非 label：内容里可能有多个按钮，label 会把点击转发给第一个按钮
    <div className={`field ${className}`} role="group">
      <span className="field__label"><span>{label}</span>{value !== undefined && <span className="field__value">{value}</span>}</span>
      {children}
      {hint && <span className={`field__hint${hintTone ? ` field__hint--${hintTone}` : ''}`}>{hint}</span>}
    </div>
  )
}

export interface Option<T extends string | number> {
  value: T
  label: string
  disabled?: boolean
  group?: string
}

export function Select<T extends string | number>({ value, options, onChange, placeholder, disabled, className = '' }: {
  value: T; options: Option<T>[]; onChange: (value: T) => void; placeholder?: string; disabled?: boolean; className?: string
}) {
  const groups = [...new Set(options.map((option) => option.group).filter(Boolean))] as string[]
  const render = (option: Option<T>) => <option key={String(option.value)} value={String(option.value)} disabled={option.disabled}>{option.label}</option>
  return (
    <select className={`control ${className}`} value={String(value)} disabled={disabled}
      onChange={(event) => {
        const match = options.find((option) => String(option.value) === event.target.value)
        onChange(match ? match.value : (event.target.value as T))
      }}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {groups.length
        ? groups.map((group) => <optgroup key={group} label={group}>{options.filter((option) => option.group === group).map(render)}</optgroup>)
        : options.map(render)}
    </select>
  )
}

export function Slider({ label, value, min, max, step, onChange, format, hint, disabled }: {
  label: ReactNode; value: number; min: number; max: number; step: number; onChange: (value: number) => void
  format?: (value: number) => string; hint?: ReactNode; disabled?: boolean
}) {
  const fill = `${((value - min) / (max - min)) * 100}%`
  return (
    <Field label={label} value={format ? format(value) : value} hint={hint}>
      <input className="slider" type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        style={{ '--fill': fill } as CSSProperties} onChange={(event) => onChange(Number(event.target.value))} />
    </Field>
  )
}

export function NumberInput({ value, onChange, min, max, step = 1, disabled }: {
  value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; disabled?: boolean
}) {
  return (
    <input className="control" type="number" value={value} min={min} max={max} step={step} disabled={disabled}
      onChange={(event) => {
        const next = Number(event.target.value)
        if (Number.isFinite(next)) onChange(next)
      }} />
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange, block, disabled }: {
  value: T; options: { value: T; label: string; icon?: LucideIcon }[]; onChange: (value: T) => void; block?: boolean; disabled?: boolean
}) {
  return (
    <div className={`segmented${block ? ' segmented--block' : ''}`} role="tablist">
      {options.map(({ value: optionValue, label, icon: Icon }) => (
        <button type="button" role="tab" key={optionValue} aria-selected={value === optionValue} disabled={disabled}
          className={`segmented__item${value === optionValue ? ' is-active' : ''}`} onClick={() => onChange(optionValue)}>
          {Icon && <Icon size={15} strokeWidth={2.1} />}{label}
        </button>
      ))}
    </div>
  )
}

export function PathField({ value, onChange, onPick, placeholder, disabled, pickLabel = '选择' }: {
  value: string; onChange?: (value: string) => void; onPick: () => void; placeholder?: string; disabled?: boolean; pickLabel?: string
}) {
  return (
    <div className="path-field">
      <input className="control" value={value} placeholder={placeholder} disabled={disabled} readOnly={!onChange} title={value}
        onChange={(event) => onChange?.(event.target.value)} />
      <Button icon={FolderOpen} onClick={onPick} disabled={disabled}>{pickLabel}</Button>
    </div>
  )
}

export function Badge({ tone, children }: { tone?: 'ok' | 'warn' | 'danger' | 'accent' | 'lilac'; children: ReactNode }) {
  return <span className={`badge${tone ? ` badge--${tone}` : ''}`}>{children}</span>
}

export function Dot({ tone, pulse }: { tone?: 'ok' | 'warn' | 'danger' | 'accent'; pulse?: boolean }) {
  return <span className={`dot${tone ? ` dot--${tone}` : ''}${pulse ? ' dot--pulse' : ''}`} aria-hidden="true" />
}

export function Progress({ value, indeterminate }: { value: number; indeterminate?: boolean }) {
  return (
    <div className={`progress${indeterminate ? ' progress--indeterminate' : ''}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress__bar" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  )
}

export function Notice({ tone, icon: Icon, children }: { tone?: 'warn' | 'danger' | 'ok'; icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className={`notice${tone ? ` notice--${tone}` : ''}`}>
      {Icon && <Icon size={16} />}
      <div className="notice__body">{children}</div>
    </div>
  )
}

export function EmptyState({ art, title, text, action }: { art?: string; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {art && <img className="empty__art" src={art} alt="" />}
      <div className="empty__title">{title}</div>
      {text && <div className="empty__text">{text}</div>}
      {action}
    </div>
  )
}

export function Collapse({ title, icon: Icon, defaultOpen = false, children }: { title: ReactNode; icon?: LucideIcon; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <div className={`collapse${open ? ' is-open' : ''}`}>
      <button type="button" className="collapse__head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {Icon && <Icon size={15} />}{title}<ChevronDown size={16} className="collapse__chevron" />
      </button>
      {open && <div className="collapse__body" id={id}>{children}</div>}
    </div>
  )
}
