import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';

export interface MenuOption<V extends string> {
  value: V;
  label: string;
}

interface Props<V extends string> {
  /** Accessible name of the button, e.g. "Due: Today". */
  label: string;
  /** Visible button content. */
  children: ComponentChildren;
  options: MenuOption<V>[];
  /** With `current`, items are radio items and the current one is checked. */
  current?: V;
  onPick: (value: V) => void;
  class?: string;
  align?: 'start' | 'end';
  disabled?: boolean;
}

/**
 * A button that opens a list of choices (the ARIA menu-button pattern):
 * arrow keys move between items, Escape or Tab closes, and focus returns to
 * the button after a pick.
 */
export function Menu<V extends string>(props: Props<V>) {
  const { options, current } = props;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = () => [...(root.current?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])];

  useEffect(() => {
    if (!open) return;
    const start = Math.max(0, options.findIndex((o) => o.value === current));
    items()[start]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div class={`menu${props.align === 'end' ? ' menu-end' : ''}`} ref={root}>
      <button
        ref={button}
        type="button"
        class={props.class}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={props.label}
        disabled={props.disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {props.children}
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div class="menu-list" role="menu" aria-label={props.label} onKeyDown={onKeyDown}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              tabIndex={-1}
              role={current === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={current === undefined ? undefined : o.value === current}
              class="menu-item"
              onClick={() => {
                close();
                props.onPick(o.value);
              }}
            >
              {o.label}
              {o.value === current && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
