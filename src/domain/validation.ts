import { isValidDate } from './dates';
import { IMPORTANCE_LEVELS, type Importance } from './types';

export const LIMITS = {
  title: 200,
  notes: 10_000,
  tagName: 40,
  steps: 100,
} as const;

/** A user-facing validation failure, optionally tied to a form field. */
export class ValidationError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Collapses internal whitespace runs and trims; titles are single-line. */
export function cleanLine(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function validateTitle(value: unknown, field = 'title', label = 'Title'): string {
  const title = cleanLine(value);
  if (!title) throw new ValidationError(`${label} can't be empty.`, field);
  if (title.length > LIMITS.title) {
    throw new ValidationError(`${label} must be ${LIMITS.title} characters or fewer.`, field);
  }
  return title;
}

export function validateNotes(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new ValidationError('Notes must be text.', 'notes');
  const notes = value.replace(/\r\n/g, '\n').trim();
  if (notes.length > LIMITS.notes) {
    throw new ValidationError(`Notes must be ${LIMITS.notes.toLocaleString()} characters or fewer.`, 'notes');
  }
  return notes;
}

export function validateDue(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (!isValidDate(value)) throw new ValidationError('Enter a valid date.', 'due');
  return value;
}

export function validateImportance(value: unknown): Importance {
  if (value == null || value === '') return 'normal';
  if (!IMPORTANCE_LEVELS.includes(value as Importance)) {
    throw new ValidationError('Choose high, normal or low importance.', 'importance');
  }
  return value as Importance;
}

export function validateTagName(value: unknown): string {
  const name = cleanLine(value);
  if (!name) throw new ValidationError("Tag name can't be empty.", 'tagName');
  if (name.length > LIMITS.tagName) {
    throw new ValidationError(`Tag name must be ${LIMITS.tagName} characters or fewer.`, 'tagName');
  }
  return name;
}
