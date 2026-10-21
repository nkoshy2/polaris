/**
 * Quick-add shorthand: "Call plumber fri !high #Home" becomes a task titled
 * "Call plumber", due next Friday, high importance, tagged Home. Every word
 * that isn't shorthand stays in the title. The UI previews the result before
 * adding, so nothing is parsed silently.
 */
import { addDays } from './dates';
import type { Importance, Tag } from './types';

export interface QuickAddParse {
  title: string;
  due: string | null;
  importance: Importance;
  /** Ids of existing tags that were named. */
  tagIds: string[];
  /** Names given with # that don't match an existing tag (ignoring case). */
  newTags: string[];
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Day of the week (0 = Sunday) of a "YYYY-MM-DD" date. */
function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function parseQuickAdd(text: string, tags: Tag[], today: string): QuickAddParse {
  let due: string | null = null;
  let importance: Importance = 'normal';
  const tagIds: string[] = [];
  const newTags: string[] = [];
  const words: string[] = [];

  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const w = word.toLocaleLowerCase();
    const day = DAYS.findIndex((d) => w === d || w === d.slice(0, 3));
    if (w === 'today') due = today;
    else if (w === 'tomorrow') due = addDays(today, 1);
    // A weekday means its next occurrence after today (so "fri" on a Friday is a week out).
    else if (day >= 0) due = addDays(today, (day - weekday(today) + 7) % 7 || 7);
    else if (w === '!high' || w === '!') importance = 'high';
    else if (w === '!low') importance = 'low';
    else if (w.length > 1 && w.startsWith('#')) {
      const name = word.slice(1);
      const tag = tags.find((t) => t.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (tag) {
        if (!tagIds.includes(tag.id)) tagIds.push(tag.id);
      } else if (!newTags.some((n) => n.toLocaleLowerCase() === name.toLocaleLowerCase())) newTags.push(name);
    } else words.push(word);
  }

  return { title: words.join(' '), due, importance, tagIds, newTags };
}
