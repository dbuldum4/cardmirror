; ─────────────────────────────────────────────────────────────────────
; Custom NSIS include. electron-builder auto-includes
; ${buildResources}/installer.nsh — i.e. this file — when building the
; NSIS target, and recognizes the customInstall / customUnInstall macros.
;
; TWO jobs live here:
;
; 1. "New > CardMirror Advanced Document" in Explorer's right-click menu via the
;    classic ShellNew mechanism: a registry value under .cmir points
;    Explorer at a template file the installer ships (extraResources →
;    $INSTDIR\resources\new-template.cmir; regenerate with
;    `npm run gen:new-template`). The submenu label is the .cmir
;    association's friendly name ("CardMirror Advanced Document").
;
; 2. The .docx association, done RIGHT. electron-builder's
;    fileAssociations mechanism (which .docx used through v1.4.0)
;    overwrites the extension's DEFAULT ProgId — and Explorer only
;    shows a ShellNew ("New > …") entry belonging to the CURRENT
;    default ProgId, so stamping ours removed Word's
;    "New > Microsoft Word Document" from the right-click menu on
;    every install and every update (field report 2026-08-26). Worse,
;    the generated class was literally NAMED "Word Document" (the
;    association's display name), and uninstall deleted the class
;    without restoring the default — leaving .docx pointing at a key
;    that no longer exists. So .docx is now registered by hand:
;      - a properly-namespaced class, CardMirrorAdvanced.docx;
;      - listed under .docx\OpenWithProgids ONLY. The extension's
;        default value is NEVER written: CardMirror appears in
;        "Open with" and the Windows default-apps UI, Word keeps its
;        ProgId, its New-menu entry, and its double-click default.
;
; SHCTX resolves to HKLM for a per-machine install and HKCU for a
; per-user install, so writes use the selected installation scope.
;
; ⚠ Registry work is verified by inspection + a real Windows install
; test; Explorer caches ShellNew and association data, so menu changes
; may need an Explorer restart or sign-out to appear.
; ─────────────────────────────────────────────────────────────────────

!include "LogicLib.nsh"

!macro customInstall
  ; ── 1. New > CardMirror Advanced Document ──
  WriteRegStr SHCTX "Software\Classes\.cmir\ShellNew" "FileName" "$INSTDIR\resources\new-template.cmir"

  ; ── 2. .docx: Open-With only, never the default ──
  WriteRegStr SHCTX "Software\Classes\CardMirrorAdvanced.docx" "" "Microsoft Word document"
  WriteRegStr SHCTX "Software\Classes\CardMirrorAdvanced.docx\DefaultIcon" "" "$INSTDIR\resources\docx.ico"
  WriteRegStr SHCTX "Software\Classes\CardMirrorAdvanced.docx\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\CardMirrorAdvanced.docx\shell\open" "" "Open with CardMirror Advanced"
  WriteRegStr SHCTX "Software\Classes\CardMirrorAdvanced.docx\shell\open\command" "" `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"`
  WriteRegNone SHCTX "Software\Classes\.docx\OpenWithProgids" "CardMirrorAdvanced.docx"

  ; Tell Explorer associations changed (SHCNE_ASSOCCHANGED, SHCNF_IDLIST).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ; Do not remove a template installed later by another application.
  ReadRegStr $0 SHCTX "Software\Classes\.cmir\ShellNew" "FileName"
  ${If} $0 == "$INSTDIR\resources\new-template.cmir"
    DeleteRegValue SHCTX "Software\Classes\.cmir\ShellNew" "FileName"
  ${EndIf}

  DeleteRegValue SHCTX "Software\Classes\.docx\OpenWithProgids" "CardMirrorAdvanced.docx"
  DeleteRegKey SHCTX "Software\Classes\CardMirrorAdvanced.docx"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
