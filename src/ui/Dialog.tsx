import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon';

interface Props {
  title: string;
  /** Called for Escape, the close button, and backdrop clicks. */
  onRequestClose: () => void;
  children: ComponentChildren;
  /** Element to focus first; defaults to the first focusable field. */
  initialFocus?: string;
  wide?: boolean;
}

/**
 * Modal built on the native <dialog> element, which provides focus trapping,
 * Escape handling and an inert background. Focus returns to the element that
 * opened the dialog (when it still exists) after closing.
 */
export function Dialog({ title, onRequestClose, children, initialFocus, wide }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2)}`).current;
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const target =
      (initialFocus && dialog.querySelector<HTMLElement>(initialFocus)) ||
      dialog.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select, button:not(.dialog-close)');
    target?.focus();
    return () => {
      dialog.close();
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      class={wide ? 'dialog dialog-wide' : 'dialog'}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onRequestClose();
      }}
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === ref.current;
      }}
      onClick={(e) => {
        // A click on the backdrop targets the <dialog> element itself. Require
        // the press to start there too, so a text selection dragged outside
        // the dialog doesn't close it.
        if (e.target === ref.current && pressedBackdrop.current) onRequestClose();
        pressedBackdrop.current = false;
      }}
    >
      <div class="dialog-inner">
        <header class="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" class="icon-button dialog-close" aria-label="Close" onClick={onRequestClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
