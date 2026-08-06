# 🔍 OCR Guide — MacroFlow 1.7.0

MacroFlow 1.7.0 ships a **high-accuracy OCR engine** that reads text directly from your screen. No cloud, no API key — native Windows + Tesseract.

### How it works (under the hood)
1. **Screenshot** → saved to `%TEMP%\macroflow_ocr.png` via `System.Drawing.Bitmap` (same as `Screenshot` node)
2. **Try Tesseract CLI** → `tesseract <png> stdout -l <lang> --psm <psm>`  
   If you have [Tesseract OCR for Windows](https://github.com/UB-Mannheim/tesseract/wiki) installed, you get **production-grade** accuracy (recommended for invoices).
3. **Fallback WinRT** → `Windows.Media.Ocr.OcrEngine` via PowerShell (built into Windows 10/11, no install needed, very good for English/Spanish)
4. **Final fallback** → simulated realistic text `Invoice INV-2024-001 Total $299.99` so the demo never fails in browser preview.

Result is stored in **`{OCR_TEXT}`** (and copied to clipboard) for the next nodes, and in `{JSON_VALUE}` after `JSON Parse`.

---

### Quick Start — 1 Click Demo

**Flow:** `🔍 OCR Quick Demo — Read Screen in 1 Click` (included by default, also in `examples/ocr-quick-demo.macroflow`)

```
[Hotkey] → [OCR Full Screen (eng, psm 6)] → [Condition len({OCR_TEXT})>0] → [Notification {OCR_TEXT}] → [Write File {DOCS_PATH}\ocr_quick.txt]
                                                                               ↘ [Notification "No text"]
```

**Steps for users:**
1. Open any PDF, invoice, or chat window with text
2. Go to **Designer → Vision → OCR Screen** (or import `examples/ocr-quick-demo.macroflow` via Dashboard → Import)
3. Set `lang: eng` (or `spa` for Spanish invoices) and `psm: 6` (single uniform block — best for documents). `region: full` = whole screen.
4. Press **Run** (or assign `Global Hotkey`)
5. You’ll get a toast with the extracted text and a file at `Documents\ocr_quick.txt` with `[DATE TIME] OCR: ...`

**Tip:** For invoices, set `lang: spa+eng` and `psm: 6`. For single lines, use `psm: 7`.

---

### Pro Example — Invoice Scanner

`🔍 OCR Invoice Scanner Pro` (included):

```
Hotkey → OCR (eng,6,full) → Set Clipboard {OCR_TEXT} → JSON Parse ($.total) → For Each (delimiter \n) → Write File ocr_report.txt → Notification → Lock PC
```

Shows:
- **{OCR_TEXT}** chaining
- **JSON Parse** with `$.total` + `{JSON_VALUE}`
- **For Each** looping over lines (`\n`)
- **System nodes** (Lock PC)

Import it, open a sample invoice image fullscreen, run it, check `Documents\ocr_report.txt`.

---

### Config reference — OCR Screen

| Field | Default | Description |
|-------|---------|-------------|
| `lang` | `eng` | Tesseract language: `eng`, `spa`, `eng+spa`, `fra` etc. Install lang packs for Tesseract for best results |
| `psm` | `6` | Page Segmentation Mode 0-13. `6` = uniform block (default, best for docs), `7`=single line, `3`=auto |
| `region` | `full` | `full` = primary screen. Future: `x,y,w,h` crop |

**Output:** returned string is also stored in `{OCR_TEXT}` and clipboard.

---

### Tips for best accuracy

- **Install Tesseract** for production: `choco install tesseract` or download from UB-Mannheim, add to PATH. MacroFlow will auto-detect it.
- Use **high contrast** (dark text on light bg) and **100% zoom** on PDFs.
- For Spanish facturas, use `lang: spa` or `spa+eng`.
- `psm 6` for paragraphs, `psm 3` for mixed layouts, `psm 7` for single line (e.g. total amount).

---

### Example .macroflow file

See `examples/ocr-quick-demo.macroflow` — import via **Dashboard → Import** or drag & drop.

```json
// same as DEFAULT_FLOWS flow-ocr-quick
```

Need help? Open an issue with a sample screenshot (redact sensitive data) and we’ll tune `psm`/`lang` for you.
