import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon';

export interface Toast {
  id: number;
  message: string;
  undoable: boolean;
  error: boolean;
}

const DURATION_MS = 8000;

function ToastItem({ toast, onDismiss, onUndo }: { toast: Toast; onDismiss: (id: number) => void; onUndo: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  const paused = useRef(false);

  // Errors stay until dismissed. Others auto-hide but pause while hovered or
  // focused; Undo also stays available in the header and via Ctrl+Z.
  useEffect(() => {
    if (toast.error) return;
    let remaining = DURATION_MS;
    const timer = setInterval(() => {
      if (paused.current) return;
      remaining -= 250;
      if (remaining <= 0) onDismiss(toast.id);
    }, 250);
    return () => clearInterval(timer);
  }, [toast.id]);

  const pause = () => (paused.current = true);
  const resume = () => {
    if (!ref.current?.contains(document.activeElement)) paused.current = false;
  };

  return (
    <li
      ref={ref}
      class={`toast${toast.error ? ' toast-error' : ''}`}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocusIn={pause}
      onFocusOut={() => setTimeout(resume)}
    >
      <span class="toast-message">{toast.message}</span>
      {toast.undoable && (
        <button
          type="button"
          class="button small"
          onClick={() => {
            onUndo();
            onDismiss(toast.id);
          }}
        >
          Undo
        </button>
      )}
      <button type="button" class="icon-button" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
        <Icon name="close" />
      </button>
    </li>
  );
}

/**
 * Notifications. Two live regions (status for normal messages, alert for
 * errors) are always present so screen readers announce new messages.
 */
export function Toasts({ toasts, onDismiss, onUndo }: { toasts: Toast[]; onDismiss: (id: number) => void; onUndo: () => void }) {
  const render = (list: Toast[]) =>
    list.map((t) => <ToastItem key={t.id} toast={t} onDismiss={onDismiss} onUndo={onUndo} />);
  return (
    <div class="toasts">
      <div role="alert">
        <ul class="toast-list" aria-label="Errors">
          {render(toasts.filter((t) => t.error))}
        </ul>
      </div>
      <div role="status">
        <ul class="toast-list" aria-label="Notifications">
          {render(toasts.filter((t) => !t.error))}
        </ul>
      </div>
    </div>
  );
}
