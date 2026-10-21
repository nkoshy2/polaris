import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../../src/domain/quickadd';
import type { Tag } from '../../src/domain/types';

const TODAY = '2026-10-18'; // a Sunday
const tag = (id: string, name: string): Tag => ({ id, name, createdAt: '', updatedAt: '' });
const TAGS = [tag('t-home', 'Home'), tag('t-work', 'Work')];

describe('quick-add shorthand', () => {
  it('leaves plain text as the title', () => {
    expect(parseQuickAdd('  Water   the plants ', TAGS, TODAY)).toEqual({
      title: 'Water the plants',
      due: null,
      importance: 'normal',
      tagIds: [],
      newTags: [],
    });
  });

  it('reads dates, importance and tags from anywhere in the text', () => {
    expect(parseQuickAdd('Call plumber fri !high #home', TAGS, TODAY)).toEqual({
      title: 'Call plumber',
      due: '2026-10-23',
      importance: 'high',
      tagIds: ['t-home'],
      newTags: [],
    });
    expect(parseQuickAdd('tomorrow Pay rent !low', TAGS, TODAY).due).toBe('2026-10-19');
    expect(parseQuickAdd('Dentist TODAY', TAGS, TODAY).due).toBe(TODAY);
    expect(parseQuickAdd('Ship it !', TAGS, TODAY).importance).toBe('high');
  });

  it('takes a weekday as its next occurrence after today', () => {
    expect(parseQuickAdd('x monday', TAGS, TODAY).due).toBe('2026-10-19');
    expect(parseQuickAdd('x sun', TAGS, TODAY).due).toBe('2026-10-25');
    expect(parseQuickAdd('x saturday', TAGS, TODAY).due).toBe('2026-10-24');
  });

  it('lists unknown tags as new, once, keeping their spelling', () => {
    const r = parseQuickAdd('Plan trip #Travel #travel #Work #work', TAGS, TODAY);
    expect(r.tagIds).toEqual(['t-work']);
    expect(r.newTags).toEqual(['Travel']);
  });

  it('keeps a lone # and words that only contain shorthand', () => {
    expect(parseQuickAdd('Fix # sign on friday-sale!', TAGS, TODAY)).toMatchObject({
      title: 'Fix # sign on friday-sale!',
      due: null,
    });
  });
});
