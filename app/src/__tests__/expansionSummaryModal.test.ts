import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Exercise the shipping content-script controller. The recording DOM below
// provides only focus, event delivery and element lifetime; actual browser
// layout and editable selections are covered by the browser insertion checks.
const source = readFileSync(resolve(process.cwd(), '..', 'extension/content/content.js'), 'utf8');

type ModalOptions = { inserted?: boolean; target?: RecordingElement };
type ShowModal = (text: string, onConfirm?: () => void, onUndo?: () => void, options?: ModalOptions) => void;

class RecordingEventTarget extends EventTarget {
  // Node's EventTarget does not match boolean capture flags when removing a
  // listener. Normalize to the object form to match browser DOM behavior.
  addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    super.addEventListener(type, callback, typeof options === 'boolean' ? { capture: options } : options);
  }
  removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    super.removeEventListener(type, callback, typeof options === 'boolean' ? { capture: options } : options);
  }
}

class RecordingElement extends RecordingEventTarget {
  id = '';
  tagName: string;
  textContent = '';
  style: Record<string, string> = {};
  parentNode: RecordingElement | null = null;
  children: RecordingElement[] = [];
  disabled = false;
  selectionStart: number | null = null;
  selectionEnd: number | null = null;
  selectionDirection: string | null = null;
  attributes = new Map<string, string>();
  private html = '';
  constructor(readonly ownerDocument: RecordingDocument, tag: string) {
    super();
    this.tagName = tag.toUpperCase();
  }
  set innerHTML(html: string) {
    this.html = html;
    this.children = [];
    // No layout model: only materialize addressable controls from the real
    // markup. Controller behavior must not depend on the visual composition.
    for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
      const attributes = match[2] ?? '';
      if (!/\bid=["']/.test(attributes)) continue;
      const child = new RecordingElement(this.ownerDocument, match[1] ?? 'div');
      for (const attr of attributes.matchAll(/([\w-]+)=["']([^"']*)["']/g)) {
        child.setAttribute(attr[1] ?? '', attr[2] ?? '');
      }
      this.appendChild(child);
    }
  }
  get innerHTML() { return this.html; }
  get isConnected(): boolean { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setSelectionRange(start: number, end: number, direction = 'none') {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }
  appendChild(child: RecordingElement) { child.parentNode = this; this.children.push(child); return child; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  contains(other: RecordingElement): boolean { return this === other || this.children.some(child => child.contains(other)); }
  querySelector(selector: string): RecordingElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector: string): RecordingElement[] {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') return descendants;
    if (selector.startsWith('#')) return descendants.filter(child => child.id === selector.slice(1));
    if (selector.includes('button')) return descendants.filter(child => child.tagName === 'BUTTON' && !child.disabled);
    return [];
  }
  focus() {
    this.ownerDocument.activeElement = this;
    this.dispatchEvent(new Event('focus'));
    this.emit('focusin', {}, true);
  }
  emit(type: string, properties: Record<string, unknown> = {}, bubbles = false) {
    const event = new Event(type, { bubbles, cancelable: true });
    Object.defineProperty(event, 'target', { value: this });
    Object.assign(event, properties);
    this.dispatchEvent(event);
    if (bubbles) {
      let parent = this.parentNode;
      while (parent) { parent.dispatchEvent(event); parent = parent.parentNode; }
      this.ownerDocument.dispatchEvent(event);
    }
    return event;
  }
}

class RecordingDocument extends RecordingEventTarget {
  body = new RecordingElement(this, 'body');
  activeElement = this.body;
  documentElement = this.body;
  createElement(tag: string) { return new RecordingElement(this, tag); }
  getElementById(id: string) { return this.body.querySelector('#' + id); }
}

function harness() {
  const document = new RecordingDocument();
  const target = document.createElement('textarea');
  document.body.appendChild(target);
  target.focus();
  const section = source.slice(source.indexOf('var activeCelebrationClose'), source.indexOf('// ── INLINE TRIGGER PICKER'));
  const create = new Function('document', 'window', section + '\nreturn { showCelebration, _expansionSummary };') as
    (document: RecordingDocument, window: unknown) => {
      showCelebration: ShowModal;
      _expansionSummary: (text: string) => { words: number; characters: number; seconds: number; timeLabel: string };
    };
  const api = create(document, { getSelection: () => null });
  function control(id: string) {
    const found = document.getElementById(id);
    if (!found) throw new Error(`Missing modal control: ${id}`);
    return found;
  }
  function key(key: string, shiftKey = false) {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key, shiftKey });
    Object.defineProperty(event, 'target', { value: document.activeElement });
    document.dispatchEvent(event);
    return event;
  }
  return { ...api, document, target, control, key };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('expansion confirmation: insertion and undo lifecycle', () => {
  it('confirms a deferred insertion once, even if a stale control is clicked later', () => {
    const h = harness();
    const insert = vi.fn();
    const cancel = vi.fn();
    h.showCelebration('A saved response.', insert, cancel, { inserted: false, target: h.target });
    const button = h.control('sb-cel-ok');
    button.emit('click');
    button.emit('click');
    vi.advanceTimersByTime(10_000);
    expect(insert).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    expect(h.document.getElementById('sb-celebrate')).toBeNull();
    expect(h.document.activeElement).toBe(h.target);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('undo cancels all pending confirmation callbacks and returns focus', () => {
    const h = harness();
    const confirm = vi.fn();
    const undo = vi.fn();
    h.showCelebration('An inserted response.', confirm, undo, { inserted: true, target: h.target });
    const button = h.control('sb-cel-undo');
    button.emit('click');
    button.emit('click');
    vi.advanceTimersByTime(10_000);
    expect(undo).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    expect(h.document.activeElement).toBe(h.target);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restores a textarea selection before the deferred insertion callback runs', () => {
    const h = harness();
    h.target.setSelectionRange(4, 12, 'backward');
    let selectionAtInsertion: unknown;
    h.showCelebration('Replacement.', () => {
      selectionAtInsertion = [h.target.selectionStart, h.target.selectionEnd, h.target.selectionDirection];
    }, vi.fn(), { inserted: false, target: h.target });
    h.target.setSelectionRange(0, 0);
    h.control('sb-cel-ok').emit('click');
    expect(selectionAtInsertion).toEqual([4, 12, 'backward']);
    expect(h.document.activeElement).toBe(h.target);
  });

  for (const dismiss of ['close', 'backdrop', 'escape'] as const) {
    for (const inserted of [true, false]) {
      it(`${dismiss} ${inserted ? 'keeps an inserted response' : 'cancels a deferred insertion'}`, () => {
        const h = harness();
        const confirm = vi.fn();
        const undo = vi.fn();
        h.showCelebration('Response.', confirm, undo, { inserted, target: h.target });
        if (dismiss === 'escape') expect(h.key('Escape').defaultPrevented).toBe(true);
        else h.control(dismiss === 'close' ? 'sb-cel-skip' : 'sb-cel-bd').emit('click');
        vi.advanceTimersByTime(10_000);
        expect(inserted ? confirm : undo).toHaveBeenCalledOnce();
        expect(inserted ? undo : confirm).not.toHaveBeenCalled();
      });
    }
  }

  it('settles the old dialog before replacement without its timer closing the new one', () => {
    const h = harness();
    const firstConfirm = vi.fn();
    const firstUndo = vi.fn();
    const secondConfirm = vi.fn();
    h.showCelebration('Pending response.', firstConfirm, firstUndo, { inserted: false, target: h.target });
    vi.advanceTimersByTime(2_000);
    h.showCelebration('Second response.', secondConfirm, vi.fn(), { inserted: true, target: h.target });
    expect(firstUndo).toHaveBeenCalledOnce();
    expect(firstConfirm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3_100);
    expect(secondConfirm).not.toHaveBeenCalled();
    expect(h.document.getElementById('sb-celebrate')).not.toBeNull();
    vi.advanceTimersByTime(1_900);
    expect(secondConfirm).toHaveBeenCalledOnce();
  });
});

describe('expansion confirmation: keyboard and countdown', () => {
  it('automatically confirms at five seconds when the user has not interacted', () => {
    const h = harness();
    const confirm = vi.fn();
    h.showCelebration('Response.', confirm, vi.fn(), { inserted: false, target: h.target });
    vi.advanceTimersByTime(4_999);
    expect(confirm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(confirm).toHaveBeenCalledOnce();
  });

  for (const interaction of ['hover', 'keyboard', 'focus'] as const) {
    it(`${interaction} stops automatic confirmation while the user considers the response`, () => {
      const h = harness();
      const confirm = vi.fn();
      h.showCelebration('Response.', confirm, vi.fn(), { inserted: true, target: h.target });
      vi.advanceTimersByTime(1_000);
      if (interaction === 'hover') h.control('sb-celebrate').emit('pointerenter');
      if (interaction === 'keyboard') h.key('Tab');
      if (interaction === 'focus') h.control('sb-cel-undo').focus();
      vi.advanceTimersByTime(10_000);
      expect(confirm).not.toHaveBeenCalled();
      expect(h.document.getElementById('sb-celebrate')).not.toBeNull();
      h.control('sb-cel-ok').emit('click');
      expect(confirm).toHaveBeenCalledOnce();
    });
  }

  it('keeps keyboard focus inside the dialog in both directions', () => {
    const h = harness();
    h.showCelebration('Response.', vi.fn(), vi.fn(), { inserted: true, target: h.target });
    const buttons = h.control('sb-celebrate').querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(1);
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    first.focus();
    expect(h.key('Tab', true).defaultPrevented).toBe(true);
    expect(h.document.activeElement).toBe(last);
    expect(h.key('Tab').defaultPrevented).toBe(true);
    expect(h.document.activeElement).toBe(first);
  });
});

describe('expansion summary: derived values', () => {
  it('does not invent words or saved time for an empty expansion', () => {
    const h = harness();
    for (const text of ['', '  \n\t  ']) {
      expect(h._expansionSummary(text)).toMatchObject({ words: 0, characters: 0, seconds: 0 });
    }
  });

  it('counts words across whitespace and estimates typing time from the actual text', () => {
    const h = harness();
    const text = 'Hello team,\n\nYour request is confirmed.';
    expect(h._expansionSummary(text)).toMatchObject({
      words: 6,
      characters: text.length,
      seconds: Math.round(text.length / 3.3),
    });
  });

  it('counts Unicode code points and normalizes Windows line endings', () => {
    expect(harness()._expansionSummary('Ciao\r\n世界🙂')).toMatchObject({ words: 2, characters: 8, seconds: 2 });
  });
});
