// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../../src/schema/index.js';
import { footnotePopoverPlugin } from '../../src/editor/footnote-popover.js';
import { openLinkExternally } from '../../src/editor/link-context-menu-plugin.js';

let view: EditorView | undefined;
afterEach(() => { view?.destroy(); view = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('unsafe link rendering and actions', () => {
  it('renders native footnote link text without an actionable unsafe address', () => {
    const note = schema.nodes['footnote']!.create({ id: 'fn1', kind: 'footnote', content: [[{ text: 'untrusted source', link: 'java\tscript:alert(1)' }, { text: 'safe source', link: 'https://example.test/' }]] });
    const doc = schema.nodes['doc']!.create(null, schema.nodes['paragraph']!.create(null, [schema.text('Evidence'), note]));
    const plugin = footnotePopoverPlugin();
    const el = document.createElement('div'); document.body.append(el);
    view = new EditorView(el, { state: EditorState.create({ doc, plugins: [plugin] }) });
    let pos = 0; doc.descendants((node, at) => { if (node === note) pos = at; });
    const click = plugin.props.handleClickOn!;
    expect(click.call(plugin, view, pos, note, pos, new MouseEvent('click'), true)).toBe(true);
    const popover = document.querySelector('.pmd-footnote-popover')!;
    expect(popover.textContent).toContain('untrusted source');
    expect(popover.querySelectorAll('a')).toHaveLength(1);
    expect(popover.querySelector('a')?.href).toBe('https://example.test/');
  });
  it('blocks direct Open Link actions for obfuscated scripts while permitting normal websites', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openLinkExternally('\u0000javascript:alert(1)');
    openLinkExternally('java\nscript:alert(1)');
    expect(open).not.toHaveBeenCalled();
    openLinkExternally('https://example.test/evidence');
    expect(open).toHaveBeenCalledWith('https://example.test/evidence', '_blank', 'noopener,noreferrer');
  });
});
