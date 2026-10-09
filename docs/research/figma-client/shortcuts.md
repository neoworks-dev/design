# Canvas shortcuts: extracted from the editor

Source: the keyboard shortcut JSON embedded in the wasm data segment (schema
`keyboard-shortcuts.schema.json`, 260 action ids). Extraction method in `README.md`.
Entry format in the JSON: `{ editModes, shortcuts: [ "Key" | ["Key", ...conditions, {display}] ] }`.

Reading the table:

- Scope `GLOBAL` means any edit mode; `!TEXT` excludes text editing; `VECTOR`, `TEXT` and so on restrict
  to that edit mode (so shortcuts are context gated by edit mode, as we guessed in `interactions.md`).
- Modifier names: `Meta` is Cmd (mac only), `Control`. "(mac)" marks mac-only entries; unmarked
  entries are for other platforms (the dump removed the `!mac` tags).
- Conditions in the raw JSON (dropped here, shown only if relevant): `pref:use-numbers-for-opacity`
  (when on, zoom shortcuts become Shift+0/1/2/9 and digits set opacity; when off, `0` zoom reset,
  `1` or `9` fit, `2` selection), `pref:use-old-outline-shortcuts`, `layout:<keyboard layout>`
  variants for non-US layouts, product filters (`figjam`, `slides`, `design`, `dev_handoff`).
- FigJam, Slides, Buzz, Sites, tables, debug and perf actions were filtered out.
- **Arrow-key nudging and Space-pan are not in this table**; they are handled in C++ (see
  `moving.md` section 5).

Notable facts versus `interactions.md` section 2:

- `duplicate-in-place` is the id for Ctrl/Cmd+D. `[confirmed-in-code]`
- `toggle-snapping-to-pixels` = Ctrl/Cmd+Shift+'; `toggle-grid` = Ctrl/Cmd+' (pixel grid, plus Shift+');
  `toggle-shown-layout-grids`: Shift+G, also Ctrl+Shift+4. Confirms the [K] items.
- `select-parent` is `\` or Shift+Enter; `select-child` Enter; Tab / Shift+Tab are next/previous
  sibling (`select-next-sibling`), confirming section 2.
- `ungroup-selection`: Ctrl+Backspace or Ctrl+Shift+G; `frame-selection` Ctrl+Alt+G; `stack-selection`
  (add auto layout) Shift+A; `unstack-selection` is present (Shift+Alt+A).
- `tidy-up` = Ctrl+Shift+Alt+T (non-mac), Ctrl+Alt+T (mac). Align uses Alt+A/D/W/S/H/V as documented.
- `previous-artboard`/`next-artboard` Shift+N / N plus `...-same-zoom` Home / End.
- `set-tool-keyboard-select` (Ctrl+Space, Alt+Space on mac): keyboard-driven tool picker.
- `set-tool-default` V, `set-tool-hand` H, `set-tool-scale` K, `set-tool-frame` F or A, `set-tool-type` T,
  `set-tool-comments` C, `toggle-dropper` I, `set-tool-measure` Shift+M, `set-tool-annotate` Y / Shift+T.
  `set-tool-shape-builder` M, `set-tool-pencil` Shift+P, `set-tool-var-width-point` Shift+W.

| action id | scope: keys |
| --- | --- |
| `delete-selection` | `GLOBAL,!TEXT`: Backspace, Delete |
| `zoom-in` | `GLOBAL`: Meta+Shift+= (mac), Control+Shift+=, Meta+= (mac), Control+=, Meta++ (mac), Control++, Meta+Num + (mac), Control+Num + ; `GLOBAL,!TEXT`: Shift+=, =, Num +, + |
| `zoom-out` | `GLOBAL`: Meta+- (mac), Control+-, Meta+Shift+- (mac), Control+Shift+-, Meta+Num - (mac), Control+Num - ; `GLOBAL,!TEXT`: -, Shift+-, Num - |
| `zoom-reset` | `GLOBAL`: Meta+0 (mac), Control+0 ; `GLOBAL,!TEXT`: 0 [!pref:use-numbers-for-opacity], Shift+0 [pref:use-numbers-for-opacity] |
| `zoom-to-fit` | `GLOBAL,!TEXT`: 1 [!pref:use-numbers-for-opacity], 9 [!pref:use-numbers-for-opacity], Shift+1 [pref:use-numbers-for-opacity], Shift+9 [pref:use-numbers-for-opacity] |
| `zoom-to-selection` | `GLOBAL,!TEXT`: 2 [!pref:use-numbers-for-opacity], Shift+2 [pref:use-numbers-for-opacity] |
| `focus-previous-area` | `GLOBAL`: Shift+F6 [mac,design], Shift+F6 [mac,dev_handoff], Shift+F6 [mac,illustration], Shift+Control+F6 [!mac,design], Shift+Control+F6 [!mac,dev_handoff], Shift+Control+F6 [!mac,illustration] |
| `focus-next-area` | `GLOBAL`: F6 [mac,design], F6 [mac,dev_handoff], F6 [mac,illustration], Control+F6 [!mac,design], Control+F6 [!mac,dev_handoff], Control+F6 [!mac,illustration] |
| `set-opacity-0` | `GLOBAL,!TEXT`: 0 [pref:use-numbers-for-opacity], Num 0 [pref:use-numbers-for-opacity], Shift+0 [!pref:use-numbers-for-opacity], Shift+Num 0 [!pref:use-numbers-for-opacity] |
| `set-opacity-1` | `GLOBAL,!TEXT`: 1 [pref:use-numbers-for-opacity], Num 1 [pref:use-numbers-for-opacity], Shift+1 [!pref:use-numbers-for-opacity], Shift+Num 1 [!pref:use-numbers-for-opacity] |
| `set-opacity-2` | `GLOBAL,!TEXT`: 2 [pref:use-numbers-for-opacity], Num 2 [pref:use-numbers-for-opacity], Shift+2 [!pref:use-numbers-for-opacity], Shift+Num 2 [!pref:use-numbers-for-opacity] |
| `set-opacity-3` | `GLOBAL,!TEXT`: 3 [pref:use-numbers-for-opacity], Num 3 [pref:use-numbers-for-opacity], Shift+3 [!pref:use-numbers-for-opacity], Shift+Num 3 [!pref:use-numbers-for-opacity] |
| `set-opacity-4` | `GLOBAL,!TEXT`: 4 [pref:use-numbers-for-opacity], Num 4 [pref:use-numbers-for-opacity], Shift+4 [!pref:use-numbers-for-opacity], Shift+Num 4 [!pref:use-numbers-for-opacity] |
| `set-opacity-5` | `GLOBAL,!TEXT`: 5 [pref:use-numbers-for-opacity], Num 5 [pref:use-numbers-for-opacity], Shift+5 [!pref:use-numbers-for-opacity], Shift+Num 5 [!pref:use-numbers-for-opacity] |
| `set-opacity-6` | `GLOBAL,!TEXT`: 6 [pref:use-numbers-for-opacity], Num 6 [pref:use-numbers-for-opacity], Shift+6 [!pref:use-numbers-for-opacity], Shift+Num 6 [!pref:use-numbers-for-opacity] |
| `set-opacity-7` | `GLOBAL,!TEXT`: 7 [pref:use-numbers-for-opacity], Num 7 [pref:use-numbers-for-opacity], Shift+7 [!pref:use-numbers-for-opacity], Shift+Num 7 [!pref:use-numbers-for-opacity] |
| `set-opacity-8` | `GLOBAL,!TEXT`: 8 [pref:use-numbers-for-opacity], Num 8 [pref:use-numbers-for-opacity], Shift+8 [!pref:use-numbers-for-opacity], Shift+Num 8 [!pref:use-numbers-for-opacity] |
| `set-opacity-9` | `GLOBAL,!TEXT`: 9 [pref:use-numbers-for-opacity], Num 9 [pref:use-numbers-for-opacity], Shift+9 [!pref:use-numbers-for-opacity], Shift+Num 9 [!pref:use-numbers-for-opacity] |
| `mode-quick-toggle-next` | `GLOBAL,!SLIDE_LAYOUT,!TEXT`: Alt+Tab [mac,!mcp_app,flag:mode_quick_toggle], Alt+` [!mac,!mcp_app,flag:mode_quick_toggle] |
| `mode-quick-toggle-previous` | `GLOBAL,!SLIDE_LAYOUT,!TEXT`: Alt+Shift+Tab [mac,!mcp_app,flag:mode_quick_toggle], Alt+Shift+` [!mac,!mcp_app,flag:mode_quick_toggle] |
| `create-section-from-selection` | `GLOBAL`: Meta+S (mac), Control+S |
| `create-savepoint` | `GLOBAL`: Meta+Alt+S (mac), Control+Alt+S |
| `paste-over-selection` | `GLOBAL`: Meta+Shift+V (mac), Control+Shift+V |
| `paste-to-replace` | `GLOBAL`: Meta+Shift+R [mac,!safari], Control+Shift+R, Meta+Shift+Alt+V (mac), Control+Shift+Alt+V |
| `duplicate-in-place` | `GLOBAL`: Meta+D (mac), Control+D |
| `flip-horizontal` | `GLOBAL,!TEXT`: Shift+H |
| `flip-vertical` | `GLOBAL,!TEXT`: Shift+V |
| `copy-properties` | `GLOBAL`: Meta+Alt+C (mac), Control+Alt+C |
| `paste-properties` | `GLOBAL`: Meta+Alt+V (mac), Control+Alt+V |
| `copy-as-png` | `GLOBAL,!TEXT`: Meta+Shift+C (mac), Control+Shift+C |
| `copy-link` | `GLOBAL,!TEXT`: Meta+L [desktop,mac], Control+L [desktop,!mac] |
| `remove-fill` | `GLOBAL,!TEXT`: Alt+/ |
| `swap-fill-and-stroke` | `GLOBAL,!TEXT`: Shift+X |
| `redo` | `GLOBAL`: Meta+Shift+Z (mac), Control+Y, Control+Shift+Z |
| `undo` | `GLOBAL,!BRANCHING`: Meta+Z (mac), Control+Z |
| `group-selection` | `GLOBAL,!TEXT`: Meta+G (mac), Control+G |
| `frame-selection` | `GLOBAL,!TEXT`: Meta+Alt+G (mac), Control+Alt+G |
| `stack-selection` | `GLOBAL,!TEXT`: Shift+A |
| `unstack-selection` | `GLOBAL,!TEXT`: Shift+Alt+A |
| `run-multi-stack-auto-layout` | `GLOBAL,!TEXT`: Shift+Control+A (mac), Shift+Control+Alt+A |
| `ungroup-selection` | `GLOBAL,!TEXT`: Meta+Backspace (mac), Meta+Shift+G (mac), Control+Backspace, Control+Shift+G |
| `unlock-all` | `GLOBAL,!TEXT`: Meta+Shift+Alt+L (mac), Control+Shift+Alt+L |
| `select-child` | `GLOBAL,!TEXT`: Enter |
| `select-parent` | `GLOBAL,!TEXT`: \, Shift+Enter |
| `select-all` | `GLOBAL`: Meta+A (mac), Control+A |
| `select-inverse` | `GLOBAL,!TEXT`: Shift+Meta+A (mac), Shift+Control+A |
| `set-tool-keyboard-select` | `GLOBAL,!TEXT`: Alt+Space [design,mac], Control+Space [design,!mac], Alt+Space [illustration,mac], Control+Space [illustration,!mac], Alt+Space [dev_handoff,mac], Control+Space [dev_handoff,!mac] |
| `join-selection` | `GLOBAL,!TEXT`: Meta+J (mac), Control+J |
| `smooth-join-selection` | `GLOBAL,!TEXT`: Meta+Shift+J (mac) |
| `flatten-selection` | `GLOBAL,!TEXT`: Alt+Shift+F, Meta+E (mac), Control+E |
| `outline-stroke` | `GLOBAL,!TEXT`: Meta+Shift+O [mac,pref:use-old-outline-shortcuts], Control+Shift+O [!mac,pref:use-old-outline-shortcuts], Meta+Alt+O [mac,!pref:use-old-outline-shortcuts], Control+Alt+O [!mac,!pref:use-old-outline-shortcuts] |
| `bring-to-front` | `GLOBAL,!TEXT`: ], Meta+Alt+] (mac), Control+Shift+] |
| `send-to-back` | `GLOBAL,!TEXT`: [, Meta+Alt+[ (mac), Control+Shift+[ |
| `text-dedent-list` | `TEXT`: Meta+[ (mac), Alt+Meta+[ (mac), Control+Meta+[ (mac), Shift+Meta+[ (mac), Control+[, Control+Alt+[, Control+Shift+[, Shift+Tab |
| `text-indent-list` | `TEXT`: Meta+] (mac), Alt+Meta+] (mac), Control+Meta+] (mac), Shift+Meta+] (mac), Control+], Control+Alt+], Control+Shift+], Tab |
| `mask-selection` | `GLOBAL,!TEXT`: Meta+Control+M (mac), Control+Alt+M |
| `rename-selection` | `GLOBAL`: Meta+R [mac,!safari], Shift+Meta+R [mac,safari], Control+R |
| `resize-to-fit` | `GLOBAL,!TEXT`: Shift+Meta+Alt+R (mac), Shift+Control+Alt+R |
| `canvas-search` | `GLOBAL`: Meta+F (mac), Control+F |
| `canvas-search-next` | `GLOBAL`: Shift+Meta+F (mac), Shift+Control+F |
| `canvas-search-prev` | `GLOBAL`: Shift+Meta+D (mac), Shift+Control+D |
| `toggle-shown-layout-grids` | `GLOBAL,!TEXT`: Shift+G, Control+G (mac), Control+Shift+4 |
| `toggle-locked-for-selected-nodes` | `GLOBAL,!TEXT`: Meta+Shift+L (mac), Control+Shift+L |
| `toggle-rulers` | `GLOBAL,!TEXT`: Shift+R |
| `collapse-layers` | `GLOBAL,!TEXT`: Alt+L |
| `toggle-bold` | `GLOBAL`: Meta+B (mac), Control+B |
| `text-toggle-italic` | `GLOBAL`: Meta+I (mac), Control+I |
| `text-toggle-underline` | `GLOBAL`: Meta+U (mac), Control+U |
| `text-edit-hyperlink` | `GLOBAL`: Meta+Shift+U [mac,!sites], Control+Shift+U [!mac,!sites] |
| `focus-link-panel` | `GLOBAL`: Meta+Shift+U [mac,sites], Control+Shift+U [!mac,sites] |
| `text-toggle-strikethrough` | `GLOBAL`: Meta+Shift+X (mac), Control+Shift+X |
| `text-delete-selection-or-end` | `TEXT`: Control+K (mac) |
| `text-delete-selection-or-next-character` | `TEXT`: Control+D (mac) |
| `toggle-grid` | `GLOBAL,!TEXT`: Shift+' ; `GLOBAL`: Meta+' (mac), Control+' |
| `toggle-menu` | `GLOBAL,!BRANCHING`: Meta+K [mac,!mcp_app], Control+K [!mac,!mcp_app], Meta+/ [mac,!mcp_app], Control+/ [!mac,!mcp_app], Meta+P [mac,!mcp_app,!handoff_extension], Control+P [!mac,!mcp_app,!handoff_extension] |
| `toggle-outlines` | `GLOBAL,!TEXT`: Shift+O [pref:use-old-outline-shortcuts], Meta+Shift+O [mac,!pref:use-old-outline-shortcuts], Control+Shift+O [!mac,!pref:use-old-outline-shortcuts] ; `GLOBAL`: Meta+Y (mac), Control+Shift+3 |
| `toggle-preferences` | `GLOBAL`: Meta+, (mac) |
| `toggle-snapping-to-pixels` | `GLOBAL`: Meta+Shift+' (mac), Control+Shift+' |
| `toggle-sidebar` | `GLOBAL`: Meta+Shift+\ [mac,!layout:portuguese], Control+Shift+\ ; `GLOBAL,!TEXT`: Shift+\ |
| `toggle-ui` | `GLOBAL,!TEXT`:  ; `GLOBAL`: Meta+\ (mac), Control+\, Meta+. [mac,!layout:hiragana_kana] |
| `toggle-multiplayer-cursors` | `GLOBAL`: Meta+Alt+\ (mac), Control+Alt+\ |
| `toggle-library` | `GLOBAL,!TEXT`: Meta+Alt+O [mac,pref:use-old-outline-shortcuts], Control+Alt+O [!mac,pref:use-old-outline-shortcuts] |
| `toggle-pixel-preview` | `GLOBAL`: Meta+Shift+P [mac,!handoff_extension], Control+Shift+P [!mac,!handoff_extension], Control+P (mac), Meta+Alt+Y (mac), Control+Alt+Y |
| `place` | `GLOBAL`: Meta+Shift+K (mac), Control+Shift+K |
| `create-symbol` | `GLOBAL`: Meta+Alt+K (mac), Control+Alt+K |
| `detach-instance` | `GLOBAL`: Meta+Alt+B (mac), Control+Alt+B |
| `find-symbol` | `GLOBAL`: Meta+Control+Alt+K (mac), Control+Alt+Shift+K |
| `convert-to-slot` | `GLOBAL,!TEXT`: Meta+Shift+S (mac), Control+Shift+S |
| `escape` | `GLOBAL`: Escape |
| `toggle-dropper` | `GLOBAL`: Control+C (mac) ; `GLOBAL,!TEXT`: I |
| `start-chat` | `GLOBAL,!TEXT`: / |
| `open-shortcuts` | `GLOBAL`: Control+Shift+/ [!layout:german,!layout:norwegian] |
| `page-previous` | `GLOBAL,!TEXT`: Page Up |
| `page-next` | `GLOBAL,!TEXT`: Page Down |
| `text-align-left` | `GLOBAL`: Meta+Alt+L (mac), Control+Alt+L |
| `text-align-right` | `GLOBAL`: Meta+Alt+R (mac), Control+Alt+R |
| `text-align-center` | `GLOBAL`: Meta+Alt+T (mac), Control+Alt+T |
| `text-align-justified` | `GLOBAL`: Meta+Alt+J (mac), Control+Alt+J |
| `text-letter-spacing-decrease` | `GLOBAL`: Alt+, (mac), Alt+, |
| `text-letter-spacing-increase` | `GLOBAL`: Alt+. (mac), Alt+. |
| `text-line-height-decrease` | `GLOBAL`: Alt+Shift+, (mac), Alt+Shift+, |
| `text-line-height-increase` | `GLOBAL`: Alt+Shift+. (mac), Alt+Shift+. |
| `text-bold-decrease` | `GLOBAL`: Meta+Alt+, (mac), Control+Alt+, |
| `text-bold-increase` | `GLOBAL`: Meta+Alt+. (mac), Control+Alt+. |
| `text-toggle-unordered-list` | `GLOBAL`: Meta+Shift+8 (mac), Control+Shift+8 |
| `text-toggle-ordered-list` | `GLOBAL`: Meta+Shift+7 (mac), Control+Shift+7 |
| `align-left` | `GLOBAL,!TEXT`: Alt+A, Meta+Control+Left (mac) |
| `align-right` | `GLOBAL,!TEXT`: Alt+D, Meta+Control+Right (mac) |
| `align-top` | `GLOBAL,!TEXT`: Alt+W, Meta+Control+Up (mac) |
| `align-bottom` | `GLOBAL,!TEXT`: Alt+S, Meta+Control+Down (mac) |
| `align-horizontal-center` | `GLOBAL,!TEXT`: Alt+H, Meta+Control+Alt+Left (mac), Meta+Control+Alt+Right (mac), Control+Shift+Alt+Left, Control+Shift+Alt+Right |
| `align-vertical-center` | `GLOBAL,!TEXT`: Alt+V, Meta+Control+Alt+Up (mac), Meta+Control+Alt+Down (mac) |
| `tidy-up` | `GLOBAL,!TEXT`: Control+Alt+T (mac), Control+Shift+Alt+T |
| `distribute-horizontal-spacing` | `GLOBAL,!TEXT`: Control+Alt+H (mac), Shift+Alt+H, Control+Shift+Alt+H, Meta+Control+Alt+H (mac) |
| `distribute-vertical-spacing` | `GLOBAL,!TEXT`: Control+Alt+V (mac), Shift+Alt+V, Meta+Control+Alt+V (mac) |
| `show-rotation-origin` | `GLOBAL,!TEXT`: Alt+R |
| `plugins-run-last` | `GLOBAL`: Meta+Alt+P (mac), Control+Alt+P |
| `dev-handoff-focus-next` | `GLOBAL,!TEXT`: Right [dev_handoff] |
| `dev-handoff-focus-previous` | `GLOBAL,!TEXT`: Left [dev_handoff] |
| `dev-handoff-extension-open-command-palette` | `DEV_HANDOFF`: Meta+Shift+P [mac,handoff_extension], Control+Shift+P [!mac,handoff_extension] |
| `dev-handoff-extension-open-file-search` | `DEV_HANDOFF`: Meta+P [mac,handoff_extension], Control+P [!mac,handoff_extension] |
| `dev-handoff-extension-close-window` | `DEV_HANDOFF`: Meta+W [mac,handoff_extension], Control+W [!mac,handoff_extension] |
| `dev-handoff-extension-quit-app` | `DEV_HANDOFF`: Meta+Q [mac,handoff_extension] |
| `show-design-panel` | `GLOBAL,!TEXT`: Alt+8 [!dev_handoff] |
| `show-prototype-panel` | `GLOBAL,!TEXT`: Alt+9 [!dev_handoff,!illustration] |
| `show-dev-mode-inspect-panel` | `GLOBAL`: Alt+8 [dev_handoff] |
| `show-dev-mode-plugins-panel` | `GLOBAL`: Alt+9 [dev_handoff] |
| `set-tool-frame` | `GLOBAL,!TEXT`: A |
| `set-tool-sticky` | `GLOBAL,!TEXT`: S [design,lab:collab-tool-shortcuts-in-design] |
| `set-tool-slice` | `GLOBAL,!TEXT`: S [design,!lab:collab-tool-shortcuts-in-design] |
| `set-tool-pencil` | `GLOBAL,!TEXT`: Shift+P |
| `set-tool-brush` | `GLOBAL,!TEXT,!VECTOR`: B [illustration] |
| `set-tool-cut` | `VECTOR`: X |
| `set-tool-paint-bucket` | `VECTOR`: Shift+B |
| `set-tool-vector-eraser` | `VECTOR`: Shift+E ; `GLOBAL,!TEXT,!VECTOR`: Shift+E [illustration] |
| `set-tool-var-width-point` | `GLOBAL,!TEXT`: Shift+W |
| `set-tool-scale` | `GLOBAL,!TEXT`: K |
| `set-tool-type` | `GLOBAL,!TEXT`: T |
| `set-tool-default-dev-handoff` | `DEV_HANDOFF`: V [dev_handoff] |
| `set-tool-hand` | `GLOBAL,!TEXT`: H |
| `set-tool-spec` | `GLOBAL,!TEXT,!VECTOR`: D [design,flag:fspc_0], D [illustration,flag:fspc_0] |
| `set-tool-code-component` | `GLOBAL,!TEXT`: B [sites], B [design,flag:bake_canvas,!lab:collab-tool-shortcuts-in-design] |
| `focus-mode-component-set-toggle` | `GLOBAL,!TEXT,!VECTOR`: Q [design], Q [sites] |
| `select-matching` | `GLOBAL,!TEXT`: Meta+Alt+A (mac), Control+Alt+A |

