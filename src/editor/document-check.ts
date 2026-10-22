/** Read-only evidence checks. Positions refer to this exact immutable document. */
import type { Node as PMNode } from 'prosemirror-model';
import { isSafeLinkHref } from '../schema/marks.js';
import { countReadAloudWords, countWords } from './word-count.js';

export interface DocumentIssue {
  code: 'missing-tag' | 'missing-citation' | 'empty-card' | 'duplicate-evidence' | 'duplicate-id' | 'unsafe-link';
  severity: 'warning' | 'info';
  pos: number;
  message: string;
}
export interface DocumentCheck {
  cards: number;
  readAloudWords: number;
  issues: DocumentIssue[];
}

export function checkDocument(doc: PMNode): DocumentCheck {
  const issues: DocumentIssue[] = [];
  const ids = new Set<string>();
  const evidence = new Map<string, number>();
  let cards = 0;
  doc.descendants((node, pos) => {
    // Derived reference content is owned by its source, not this document.
    if (node.type.name === 'zone_shadow' || node.type.name === 'transclusion') return false;
    const id = node.attrs['id'];
    if (typeof id === 'string' && id) {
      if (ids.has(id)) issues.push({ code: 'duplicate-id', severity: 'warning', pos, message: 'This heading shares an ID with another heading. References may target the wrong one.' });
      ids.add(id);
    }
    for (const mark of node.marks) {
      if (mark.type.name === 'link' && !isSafeLinkHref(String(mark.attrs['href'] ?? ''))) {
        issues.push({ code: 'unsafe-link', severity: 'warning', pos, message: 'An unsafe link was blocked. Edit or remove its address before sharing.' });
      }
    }
    if (node.type.name !== 'card') return true;
    cards++;
    const label = node.firstChild?.textContent.trim();
    if (!label) issues.push({ code: 'missing-tag', severity: 'warning', pos, message: `Card ${cards} has an empty tag.` });
    const body: string[] = [];
    let hasCitation = false;
    node.forEach((child) => {
      if (child.type.name === 'cite_paragraph' && child.textContent.trim()) hasCitation = true;
      if (child.type.name === 'card_body' || child.type.name === 'paragraph') body.push(child.textContent);
    });
    const text = body.join(' ').replace(/\s+/g, ' ').trim();
    if (!text) issues.push({ code: 'empty-card', severity: 'info', pos, message: `Card ${cards} has no evidence body.` });
    else if (!hasCitation) issues.push({ code: 'missing-citation', severity: 'warning', pos, message: `Card ${cards}${label ? ` (${label.slice(0, 80)})` : ''} has evidence but no citation line.` });
    // Avoid treating stock one-liners as duplicate evidence.
    if (countWords(text) >= 12) {
      const prior = evidence.get(text);
      if (prior !== undefined) issues.push({ code: 'duplicate-evidence', severity: 'info', pos, message: `Card ${cards} repeats the evidence body of card ${prior}.` });
      else evidence.set(text, cards);
    }
    return true;
  });
  return { cards, readAloudWords: countReadAloudWords(doc), issues };
}

export function formatDocumentCheck(report: DocumentCheck): string {
  const warnings = report.issues.filter((issue) => issue.severity === 'warning').length;
  return [
    `${report.cards} cards · ${report.readAloudWords} read-aloud words`,
    `${warnings} warnings · ${report.issues.length - warnings} notes`,
    ...report.issues.map((issue) => `${issue.severity === 'warning' ? 'Warning' : 'Note'}: ${issue.message}`),
    ...(report.issues.length === 0 ? ['No issues found by these checks.'] : []),
  ].join('\n');
}
