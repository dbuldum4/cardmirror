import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { checkDocument } from './document-check.js';
import { pushOverlay, popOverlay } from './overlay-stack.js';
import { armDialogFocus, captureFocusForDialog, installModalKeys } from './text-prompt.js';
import { isBackdropClick } from './backdrop-click.js';

let closeCurrent: (() => void) | null = null;

/** Existing modal styling and focus handling; never changes document content. */
export function openDocumentCheck(view: EditorView): void {
  closeCurrent?.();
  const snapshot = view.state.doc;
  const report = checkDocument(snapshot);
  const overlay = document.createElement('div');
  overlay.className = 'pmd-settings-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'pmd-settings-dialog';
  const header = document.createElement('header');
  header.className = 'pmd-settings-header';
  const title = document.createElement('h2');
  title.textContent = 'Check Document';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  header.append(title, closeButton);
  const body = document.createElement('div');
  body.className = 'pmd-settings-list';
  const summary = document.createElement('p');
  summary.textContent = `${report.cards} cards · ${report.readAloudWords} read-aloud words · ${report.issues.length} items to review`;
  body.append(summary);
  const description = document.createElement('p');
  description.textContent = 'Checks empty tags, missing citations, empty cards, repeated evidence, heading IDs, and blocked links. These checks do not verify source accuracy.';
  body.append(description);
  const token = pushOverlay();
  const restoreFocus = captureFocusForDialog();
  let removeKeys = (): void => {};
  const close = (): void => {
    if (closeCurrent !== close) return;
    closeCurrent = null;
    removeKeys();
    popOverlay(token);
    overlay.remove();
    restoreFocus();
  };
  closeCurrent = close;
  for (const issue of report.issues.slice(0, 200)) {
    const row = document.createElement('button');
    row.type = 'button';
    row.style.cssText = 'display:block;width:100%;text-align:left;margin:8px 0;white-space:normal';
    row.textContent = `${issue.severity === 'warning' ? 'Warning' : 'Note'}: ${issue.message}`;
    row.addEventListener('click', () => {
      // Collaboration can change positions while the dialog is open. Re-check
      // instead of jumping to a stale location in a different document state.
      if (view.state.doc !== snapshot) { openDocumentCheck(view); return; }
      close();
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(issue.pos))).scrollIntoView());
      view.focus();
    });
    body.append(row);
  }
  if (report.issues.length > 200) {
    const more = document.createElement('p');
    more.textContent = 'Showing the first 200 items. Re-run after reviewing these, or use the command-line report for the full list.';
    body.append(more);
  }
  if (!report.issues.length) {
    const clear = document.createElement('p');
    clear.textContent = 'No issues found by these checks.';
    body.append(clear);
  }
  dialog.append(header, body);
  overlay.append(dialog);
  document.body.append(overlay);
  removeKeys = installModalKeys(dialog, token, (event) => {
    if (event.key !== 'Escape') return false;
    close(); return true;
  });
  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (isBackdropClick(event, overlay)) close(); });
  armDialogFocus(dialog, 'dialog', 'Check Document');
}
