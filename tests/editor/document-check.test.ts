import { describe, expect, it } from 'vitest';
import { schema } from '../../src/schema/index.js';
import { checkDocument, formatDocumentCheck } from '../../src/editor/document-check.js';

const paragraph = (type: string, text = '') => schema.nodes[type]!.create(null, text ? schema.text(text) : undefined);
const card = (tag: string, body: string, cite = '') => schema.nodes['card']!.createChecked(null, [paragraph('tag', tag), ...(cite ? [paragraph('cite_paragraph', cite)] : []), paragraph('card_body', body)]);
const doc = (...nodes: ReturnType<typeof card>[]) => schema.nodes['doc']!.createChecked(null, nodes);

describe('read-only evidence checks', () => {
  it('finds missing tags/citations and empty evidence without changing content', () => {
    const input = doc(card('', 'A real evidence body.'), card('Placeholder', ''));
    const before = input.toJSON();
    const result = checkDocument(input);
    expect(result.cards).toBe(2);
    expect(result.issues.map((issue) => issue.code)).toEqual(['missing-tag', 'missing-citation', 'empty-card']);
    expect(input.toJSON()).toEqual(before);
    for (const issue of result.issues) expect(input.nodeAt(issue.pos)?.type.name).toBe('card');
  });
  it('identifies exact repeated substantive evidence but ignores stock short text', () => {
    const text = 'This is sufficiently detailed evidence with more than twelve words and a specific substantive claim.';
    const result = checkDocument(doc(card('One', text, 'Author 2026'), card('Two', text, 'Author 2026'), card('Three', 'Short phrase', 'A'), card('Four', 'Short phrase', 'B')));
    expect(result.issues).toEqual([expect.objectContaining({ code: 'duplicate-evidence', severity: 'info', message: expect.stringContaining('card 1') })]);
  });
  it('warns about unsafe native links and duplicate reference IDs', () => {
    const a = schema.nodes['pocket']!.create({ id: 'same' }, schema.text('A'));
    const b = schema.nodes['block']!.create({ id: 'same' }, schema.text('B'));
    const p = schema.nodes['paragraph']!.create(null, schema.text('blocked', [schema.marks['link']!.create({ href: 'java\tscript:alert(1)' })]));
    expect(checkDocument(doc(a, b, p)).issues.map((issue) => issue.code)).toEqual(['duplicate-id', 'unsafe-link']);
  });
  it('accepts a cited card and formats a readable report', () => {
    const result = checkDocument(doc(card('A claim', 'Evidence with a source.', 'Author, 2026')));
    expect(result.issues).toEqual([]);
    expect(formatDocumentCheck(result)).toContain('No issues found');
    expect(formatDocumentCheck(result)).toContain('1 cards');
  });
});
