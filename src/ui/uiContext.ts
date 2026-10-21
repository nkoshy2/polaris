import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Importance, Task } from '../domain/types';

/** Prefilled fields for a new task (e.g. from quick-add shorthand). */
export interface EditorDraft {
  title?: string;
  due?: string | null;
  importance?: Importance;
  tagIds?: string[];
}

export interface EditorTarget {
  /** Existing task to edit, or undefined to create a new one. */
  taskId?: string;
  /** Prefilled fields for a new task. */
  draft?: EditorDraft;
}

export interface UI {
  openEditor(target: EditorTarget): void;
  /** Shows a toast. `undoable` adds an Undo button for the latest change. */
  notify(message: string, options?: { undoable?: boolean; error?: boolean }): void;
  /** Runs an action, turning thrown errors into an error toast. Returns success. */
  attempt(action: () => void): boolean;
  /** Moves focus to a task row's checkbox after the next render, or to a fallback. */
  focusTask(taskId: string | null, fallbackSelector?: string): void;
}

export const UIContext = createContext<UI | null>(null);

export function useUI(): UI {
  const ui = useContext(UIContext);
  if (!ui) throw new Error('useUI must be used inside <UIContext.Provider>.');
  return ui;
}

export type { Task };
