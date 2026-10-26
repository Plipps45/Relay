import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, X } from 'lucide-react'

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive'

const VARIANTS: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-border bg-transparent shadow-xs hover:bg-accent',
  ghost: 'bg-transparent hover:bg-accent text-foreground',
  destructive: 'bg-destructive text-white hover:bg-destructive/90'
}

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }): ReactNode {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
        VARIANTS[variant],
        className
      )}
      {...props}
    />
  )
}

export function IconButton({
  label,
  className,
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }): ReactNode {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        active && 'bg-accent text-foreground',
        className
      )}
      {...props}
    />
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  // cn doesn't resolve Tailwind conflicts, so defaults the caller overrides are left out.
  const custom = className ?? ''
  return (
    <input
      className={cn(
        'rounded-md border border-input bg-transparent px-2.5 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-[invalid=true]:border-destructive',
        !/(^|\s)w-/.test(custom) && 'w-full',
        !/(^|\s)h-/.test(custom) && 'h-8',
        !/(^|\s)text-(3xs|2xs|xs|sm|base|lg|\[)/.test(custom) && 'text-sm',
        className
      )}
      {...props}
    />
  )
}

export function Kbd({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-px font-sans text-2xs text-muted-foreground">
      {children}
    </kbd>
  )
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }): ReactNode {
  return (
    <div className="mb-1.5 flex items-baseline justify-between">
      <span className="text-xs font-medium">{children}</span>
      {hint ? <span className="text-2xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  width = 520
}: {
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  width?: number
}): ReactNode {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[76vh] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-floating"
        style={{ width }}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1">
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto px-5 pb-4">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body
  )
}

export type MenuItem =
  | {
      kind?: 'item'
      label: string
      icon?: ReactNode
      shortcut?: string
      onSelect?: () => void
      danger?: boolean
      checked?: boolean
      disabled?: boolean
      submenu?: MenuItem[]
    }
  | { kind: 'separator' }
  | { kind: 'header'; label: string }

export type MenuAnchor = { x: number; y: number; align?: 'start' | 'end' }

export function Menu({ items, anchor, onClose, minWidth = 200 }: { items: MenuItem[]; anchor: MenuAnchor; onClose: () => void; minWidth?: number }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y })
  const [openSub, setOpenSub] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const rect = element.getBoundingClientRect()
    let left = anchor.align === 'end' ? anchor.x - rect.width : anchor.x
    let top = anchor.y
    left = Math.max(4, Math.min(left, window.innerWidth - rect.width - 4))
    if (top + rect.height > window.innerHeight - 4) {
      top = Math.max(4, anchor.y - rect.height)
    }
    setPosition({ left, top })
  }, [anchor])

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[60] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-floating"
      style={{ left: position.left, top: position.top, minWidth }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.kind === 'separator') {
          return <div key={index} className="-mx-1 my-1 h-px bg-border" />
        }
        if (item.kind === 'header') {
          return (
            <div key={index} className="px-2 pt-1.5 pb-1 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
              {item.label}
            </div>
          )
        }
        return (
          <div key={index} className="relative" onMouseEnter={() => setOpenSub(item.submenu ? index : null)}>
            <button
              type="button"
              disabled={item.disabled}
              className={cn(
                'flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-accent disabled:opacity-40',
                item.danger && 'text-destructive'
              )}
              onClick={() => {
                if (item.submenu) {
                  setOpenSub(index)
                  return
                }
                onClose()
                item.onSelect?.()
              }}
            >
              <span className="flex size-4 items-center justify-center text-muted-foreground [&>svg]:size-3.5">
                {item.checked ? <Check className="size-3.5" /> : item.icon}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut ? <span className="text-2xs text-muted-foreground">{item.shortcut}</span> : null}
              {item.submenu ? <ChevronRight className="size-3.5 text-muted-foreground" /> : null}
            </button>
            {item.submenu && openSub === index ? (
              <SubMenu items={item.submenu} onClose={onClose} />
            ) : null}
          </div>
        )
      })}
    </div>,
    document.body
  )
}

function SubMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }): ReactNode {
  return (
    <div className="absolute top-0 left-full z-[61] ml-1 min-w-[170px] rounded-lg border border-border bg-popover p-1 shadow-floating">
      {items.map((item, index) =>
        item.kind === 'separator' ? (
          <div key={index} className="-mx-1 my-1 h-px bg-border" />
        ) : item.kind === 'header' ? null : (
          <button
            key={index}
            type="button"
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-accent"
            onClick={() => {
              onClose()
              item.onSelect?.()
            }}
          >
            <span className="flex size-4 items-center justify-center text-muted-foreground [&>svg]:size-3.5">
              {item.checked ? <Check className="size-3.5" /> : item.icon}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        )
      )}
    </div>
  )
}

export function useMenu(): {
  menu: { items: MenuItem[]; anchor: MenuAnchor } | null
  openAt: (items: MenuItem[], anchor: MenuAnchor) => void
  openBelow: (items: MenuItem[], element: HTMLElement, align?: 'start' | 'end') => void
  close: () => void
  render: () => ReactNode
} {
  const [menu, setMenu] = useState<{ items: MenuItem[]; anchor: MenuAnchor } | null>(null)
  const close = (): void => setMenu(null)
  return {
    menu,
    openAt: (items, anchor) => setMenu({ items, anchor }),
    openBelow: (items, element, align = 'start') => {
      const rect = element.getBoundingClientRect()
      setMenu({ items, anchor: { x: align === 'end' ? rect.right : rect.left, y: rect.bottom + 4, align } })
    },
    close,
    render: () => (menu ? <Menu items={menu.items} anchor={menu.anchor} onClose={close} /> : null)
  }
}

export function Spinner({ className }: { className?: string }): ReactNode {
  return (
    <svg className={cn('size-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: string }): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
        checked ? 'bg-primary' : 'bg-input'
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
}): ReactNode {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className={cn(
        'h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring',
        className
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
