import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Upload, FileSpreadsheet, FileImage, Download, CloudUpload, Type, Settings2, ChevronDown, Plus, Trash2,
  AlignLeft, AlignCenter, AlignRight, Bold, Italic, Check, Link2, Users, FileCheck2, MousePointer2, X,
  FolderOpen, LoaderCircle,
} from 'lucide-react';
import './styles.css';

/* ---------- Constants & helpers ---------- */

// Built-in fonts exist in both the preview (CSS) and the PDF (pdf-lib standard fonts), so what you see is what you get.
const BUILTIN_FONTS = {
  Helvetica: { css: "Helvetica, Arial, sans-serif", pdf: 'Helvetica' },
  'Times Roman': { css: "'Times New Roman', Times, serif", pdf: 'TimesRoman' },
  Courier: { css: "'Courier New', Courier, monospace", pdf: 'Courier' },
};
const LINE_HEIGHT = 1.12;
const ANCHOR = { left: '0,-50%', center: '-50%,-50%', right: '-100%,-50%' };

const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const nextTick = () => new Promise((r) => setTimeout(r));
const newField = (o = {}) => ({
  id: uid(), label: 'Text field', text: 'Your text here', x: 0.5, y: 0.72, size: 24,
  color: '#252525', font: 'Times Roman', bold: false, italic: false, align: 'center', ...o,
});
const cleanName = (s) => String(s || 'Participant').trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ') || 'Participant';
const driveFolderId = (url) => String(url).match(/folders\/([\w-]+)/)?.[1] || String(url).trim().match(/^[\w-]{15,}$/)?.[0] || '';
const safeStore = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
const fontCss = (name) => BUILTIN_FONTS[name]?.css || `'${name}', sans-serif`;
const fieldText = (f, person, nameCol, emailCol, sample) =>
  f.text
    .replaceAll('{{name}}', person ? String(person[nameCol] ?? '') : sample)
    .replaceAll('{{email}}', person ? String(person[emailCol] ?? '') : 'name@example.com');

const SNAP = 0.008;
// Moves a layer's anchor, optionally snapping its visual centre to the canvas centre. Reports which centre lines are hit.
function place(canvas, f, x, y, tol, snap) {
  const el = canvas?.querySelector(`[data-id="${f.id}"]`);
  const off = el ? (el.offsetWidth / canvas.offsetWidth) * (f.align === 'left' ? 0.5 : f.align === 'right' ? -0.5 : 0) : 0;
  const dx = x + off - 0.5, dy = y - 0.5;
  const v = Math.abs(dx) < tol, h = Math.abs(dy) < tol;
  if (snap) { if (v) x -= dx; if (h) y = 0.5; }
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000, v, h };
}

async function readTemplate(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  let bytes, kind;
  if (file.type === 'image/webp') {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    bytes = await (await new Promise((r) => canvas.toBlob(r, 'image/png'))).arrayBuffer();
    kind = 'png';
  } else {
    bytes = await file.arrayBuffer();
    kind = file.type === 'image/png' ? 'png' : 'jpg';
  }
  return { url, bytes, kind, width: img.naturalWidth, height: img.naturalHeight };
}

/* ---------- PDF generation (libraries load only when needed) ---------- */

async function preparePdf({ template, fields, fontFiles }) {
  const [pdfLib, fontkit] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit').then((m) => m.default)]);
  const { PDFDocument } = pdfLib;
  // The template image is decoded once and copied into every certificate, which is much faster than re-embedding it.
  const base = await PDFDocument.create();
  const page = base.addPage([template.width, template.height]);
  const bg = template.kind === 'png' ? await base.embedPng(template.bytes) : await base.embedJpg(template.bytes);
  page.drawImage(bg, { x: 0, y: 0, width: template.width, height: template.height });
  const fontBytes = {};
  for (const f of fields) if (fontFiles[f.font] && !fontBytes[f.font]) fontBytes[f.font] = await fontFiles[f.font].arrayBuffer();
  return { pdfLib, fontkit, base, template, fields, fontBytes };
}

async function renderPdf(ctx, person, cols) {
  const { PDFDocument, StandardFonts, rgb } = ctx.pdfLib;
  const { width: W, height: H } = ctx.template;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(ctx.fontkit);
  const [page] = await pdf.copyPages(ctx.base, [0]);
  pdf.addPage(page);
  const cache = new Map();
  const getFont = (f) => {
    const custom = ctx.fontBytes[f.font];
    const key = custom ? f.font : `${f.font}|${f.bold}|${f.italic}`;
    if (!cache.has(key)) {
      if (custom) cache.set(key, pdf.embedFont(custom, { subset: true }));
      else {
        const base = BUILTIN_FONTS[f.font]?.pdf || 'Helvetica';
        const italic = base === 'TimesRoman' ? 'Italic' : 'Oblique';
        cache.set(key, pdf.embedFont(StandardFonts[base + (f.bold ? 'Bold' : '') + (f.italic ? italic : '')] || StandardFonts[base]));
      }
    }
    return cache.get(key);
  };
  for (const f of ctx.fields) {
    const font = await getFont(f);
    const h = f.color.replace('#', '');
    const color = rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
    const lines = fieldText(f, person, cols.name, cols.email).split('\n');
    const size = Number(f.size), lh = size * LINE_HEIGHT;
    const top = H - f.y * H + (lines.length * lh) / 2;
    lines.forEach((line, i) => {
      let w;
      try { w = font.widthOfTextAtSize(line, size); }
      catch { throw new Error(`The font “${f.font}” can’t print “${line}”. Add a .ttf or .otf font that supports this language.`); }
      let x = f.x * W;
      if (f.align === 'center') x -= w / 2;
      if (f.align === 'right') x -= w;
      page.drawText(line, { x, y: top - (i + 0.5) * lh - size * 0.35, size, font, color });
    });
  }
  return pdf.save();
}

/* ---------- Google Drive ---------- */

const loadGsi = () =>
  window.google?.accounts?.oauth2
    ? Promise.resolve()
    : new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection.'));
        document.head.appendChild(s);
      });

async function uploadDrive(token, folderId, name, bytes) {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, mimeType: 'application/pdf', parents: [folderId] })], { type: 'application/json' }));
  form.append('file', new Blob([bytes], { type: 'application/pdf' }));
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  if (res.status === 401) throw new Error('Your Google session expired. Start the upload again to sign in.');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || `Google Drive upload failed (${res.status}).`);
}

/* ---------- Canvas text layer ---------- */

const CanvasText = memo(function CanvasText({ f, text, selected, templateWidth, onPointerDown, onResizeStart }) {
  return (
    <div
      data-id={f.id}
      className={`canvas-text${selected ? ' is-selected' : ''}`}
      onPointerDown={(e) => onPointerDown(e, f)}
      style={{
        left: `${f.x * 100}%`, top: `${f.y * 100}%`,
        fontFamily: fontCss(f.font), fontSize: `${(f.size / templateWidth) * 100}cqw`,
        color: f.color, fontWeight: f.bold ? 700 : 400, fontStyle: f.italic ? 'italic' : 'normal',
        textAlign: f.align, transform: `translate(${ANCHOR[f.align]})`,
      }}
    >
      {text}
      {selected && (
        <>
          <span className="selection-tag">{f.label}</span>
          {['tl', 'tr', 'bl', 'br'].map((c) => (
            <span key={c} className={`handle handle-${c}`} onPointerDown={(e) => onResizeStart(e, f)} />
          ))}
        </>
      )}
    </div>
  );
});

/* ---------- App ---------- */

function App() {
  const [template, setTemplate] = useState(null);
  const [fields, setFields] = useState(() => [newField({ id: 'participant-name', label: 'Participant name', text: '{{name}}', y: 0.56, size: 42 })]);
  const [selected, setSelected] = useState('participant-name');
  const [tab, setTab] = useState('style');
  const [participants, setParticipants] = useState([]);
  const [columns, setColumns] = useState([]);
  const [nameColumn, setNameColumn] = useState('');
  const [emailColumn, setEmailColumn] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [sampleName, setSampleName] = useState('Alex Johnson');
  const [clientId, setClientId] = useState(() => safeStore.get('cf-google-client'));
  const [driveUrl, setDriveUrl] = useState('');
  const [fontFiles, setFontFiles] = useState({});
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [dragging, setDragging] = useState(null);
  const [guides, setGuides] = useState({ v: false, h: false });
  const [dropActive, setDropActive] = useState(false);
  const [showDrive, setShowDrive] = useState(false);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const tokenRef = useRef({ value: '', exp: 0 });
  const fileInput = useRef(null), sheetInput = useRef(null), fontInput = useRef(null);
  const field = fields.find((f) => f.id === selected);
  const fontNames = [...Object.keys(BUILTIN_FONTS), ...Object.keys(fontFiles)];

  useEffect(() => { if (showDrive) loadGsi().catch(() => {}); }, [showDrive]);
  useEffect(() => {
    if (!status || generating) return;
    const t = setTimeout(() => setStatus(''), 6000);
    return () => clearTimeout(t);
  }, [status, generating]);

  const fieldsRef = useRef(fields); fieldsRef.current = fields;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const handlers = useRef({});
  const guideTimer = useRef(0);

  const updateField = useCallback((patch) => setFields((fs) => fs.map((f) => (f.id === selectedRef.current ? { ...f, ...patch } : f))), []);
  const addField = () => { const f = newField(); setFields((fs) => [...fs, f]); setSelected(f.id); setTab('style'); };
  const removeField = useCallback((id) => {
    setFields((fs) => fs.filter((f) => f.id !== id));
    setSelected((s) => (s === id ? null : s));
  }, []);
  const showGuides = useCallback((v, h, hold) => {
    setGuides((g) => (g.v === v && g.h === h ? g : { v, h }));
    clearTimeout(guideTimer.current);
    if (hold) guideTimer.current = setTimeout(() => setGuides({ v: false, h: false }), 700);
  }, []);

  /* Move: offset-aware, snaps to centre lines, one update per frame */
  const onPointerDown = useCallback((e, f) => {
    e.preventDefault();
    document.activeElement?.blur?.(); // so arrow keys move the text, not an input caret
    setSelected(f.id);
    const rect = canvasRef.current.getBoundingClientRect();
    dragRef.current = { mode: 'move', id: f.id, rect, dx: (e.clientX - rect.left) / rect.width - f.x, dy: (e.clientY - rect.top) / rect.height - f.y };
    setDragging('move');
  }, []);
  /* Resize: dragging a corner scales the font size by distance from the text centre */
  const onResizeStart = useCallback((e, f) => {
    e.preventDefault(); e.stopPropagation();
    const r = e.currentTarget.parentElement.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    dragRef.current = { mode: 'resize', id: f.id, cx, cy, d0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1, size0: f.size };
    setSelected(f.id);
    setDragging('resize');
  }, []);
  useEffect(() => {
    if (!dragging) return;
    let raf = 0, last = null;
    const flush = () => {
      raf = 0;
      const d = dragRef.current;
      if (!d || !last) return;
      if (d.mode === 'resize') {
        const size = clamp(Math.round((d.size0 * Math.hypot(last.clientX - d.cx, last.clientY - d.cy)) / d.d0), 6, 300);
        setFields((fs) => fs.map((f) => (f.id === d.id ? { ...f, size } : f)));
        return;
      }
      const f = fieldsRef.current.find((x) => x.id === d.id);
      if (!f) return;
      const p = place(
        canvasRef.current, f,
        clamp((last.clientX - d.rect.left) / d.rect.width - d.dx, 0, 1),
        clamp((last.clientY - d.rect.top) / d.rect.height - d.dy, 0, 1),
        SNAP, true,
      );
      showGuides(p.v, p.h, false);
      setFields((fs) => fs.map((x) => (x.id === d.id ? { ...x, x: p.x, y: p.y } : x)));
    };
    const move = (e) => { last = e; if (!raf) raf = requestAnimationFrame(flush); };
    const up = () => { setDragging(null); showGuides(false, false, false); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, showGuides]);

  /* Keyboard: arrows nudge (Shift = bigger step), Delete removes, Escape deselects */
  useEffect(() => {
    if (showDrive) return;
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const id = selectedRef.current;
      if (!id) return;
      if (e.key === 'Escape') return setSelected(null);
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return removeField(id); }
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      const f = fieldsRef.current.find((x) => x.id === id);
      if (!dir || !f) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.02 : 0.005;
      const p = place(canvasRef.current, f, clamp(f.x + dir[0] * step, 0, 1), clamp(f.y + dir[1] * step, 0, 1), 0.0025, false);
      setFields((fs) => fs.map((x) => (x.id === id ? { ...x, x: p.x, y: p.y } : x)));
      showGuides(p.v, p.h, true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showDrive, removeField, showGuides]);

  /* Drag and drop files anywhere on the page: images become the template, sheets the participant list */
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer?.types?.includes('Files');
    const enter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDropActive(true); };
    const over = (e) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDropActive(false); };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; setDropActive(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (/\.(xlsx|xls|csv)$/i.test(file.name)) { setTab('data'); handlers.current.onSheet(file); }
      else if (/\.(ttf|otf|woff)$/i.test(file.name)) handlers.current.onFont(file);
      else handlers.current.onTemplate(file);
    };
    const ev = { dragenter: enter, dragover: over, dragleave: leave, drop };
    Object.entries(ev).forEach(([k, fn]) => window.addEventListener(k, fn));
    return () => Object.entries(ev).forEach(([k, fn]) => window.removeEventListener(k, fn));
  }, []);

  /* File inputs */
  const onTemplate = async (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setStatus('Upload a PNG, JPG or WEBP template.');
    try {
      const t = await readTemplate(file);
      setTemplate((old) => { if (old) URL.revokeObjectURL(old.url); return t; });
      setStatus('Template loaded. Drag the text to position it.');
    } catch { setStatus('This image could not be read. Try another file.'); }
  };
  const onSheet = async (file) => {
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const wb = /\.csv$/i.test(file.name)
        ? XLSX.read(await file.text(), { type: 'string' }) // text keeps non-English names intact
        : XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      if (!rows.length) return setStatus('The first sheet has no rows. Add a header row and at least one participant.');
      const keys = Object.keys(rows[0]);
      setParticipants(rows); setColumns(keys); setSheetName(file.name);
      setNameColumn(keys.find((k) => /name|participant|student/i.test(k)) || keys[0]);
      setEmailColumn(keys.find((k) => /e?mail/i.test(k)) || '');
      setStatus(`${rows.length} participants imported from ${file.name}.`);
    } catch { setStatus('Could not read this file. Use .xlsx, .xls or .csv.'); }
  };
  const onFont = async (file) => {
    if (!file) return;
    const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[^\w -]/g, '') || 'Custom font';
    try {
      const face = new FontFace(name, await file.arrayBuffer());
      document.fonts.add(await face.load());
      setFontFiles((v) => ({ ...v, [name]: file }));
      updateField({ font: name });
      setStatus(`Font “${name}” added.`);
    } catch { setStatus('This font file could not be loaded. Use a .ttf or .otf file.'); }
  };

  handlers.current = { onTemplate, onSheet, onFont };

  /* Google token (cached until expiry) */
  const getToken = async () => {
    const t = tokenRef.current;
    if (t.value && Date.now() < t.exp) return t.value;
    if (!clientId.trim()) throw new Error('Enter your Google OAuth client ID first.');
    await loadGsi();
    return new Promise((resolve, reject) => {
      window.google.accounts.oauth2.initTokenClient({
        client_id: clientId.trim(),
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (r) => {
          if (r.error) return reject(new Error(`Google sign-in failed: ${r.error}`));
          tokenRef.current = { value: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 };
          resolve(r.access_token);
        },
        error_callback: () => reject(new Error('Google sign-in was closed or blocked.')),
      }).requestAccessToken();
    });
  };

  const generate = async (toDrive = false) => {
    if (!template) return setStatus('Upload a certificate template first.');
    if (!participants.length || !nameColumn) return setStatus('Upload a participant list and choose the name column.');
    const folderId = driveFolderId(driveUrl);
    if (toDrive && !folderId) { setStatus('Paste a valid Google Drive folder link.'); return setShowDrive(true); }
    setGenerating(true); setProgress(0); setStatus(toDrive ? 'Connecting to Google Drive…' : 'Preparing certificates…');
    try {
      const token = toDrive ? await getToken() : null; // first await keeps the click gesture for the sign-in popup
      const ctx = await preparePdf({ template, fields, fontFiles });
      const cols = { name: nameColumn, email: emailColumn };
      const zip = toDrive ? null : new (await import('jszip')).default();
      const used = new Set();
      const names = participants.map((p, i) => {
        const base = cleanName(p[nameColumn]);
        let n = `${base}.pdf`;
        if (used.has(n.toLowerCase())) n = `${base} (${i + 1}).pdf`;
        used.add(n.toLowerCase());
        return n;
      });
      let next = 0, done = 0;
      const worker = async () => {
        while (next < participants.length) {
          const i = next++;
          const bytes = await renderPdf(ctx, participants[i], cols);
          if (toDrive) await uploadDrive(token, folderId, names[i], bytes); else zip.file(names[i], bytes);
          done++;
          setProgress(Math.round((done / participants.length) * 100));
          setStatus(`${toDrive ? 'Uploading' : 'Generating'} ${done} of ${participants.length}`);
          await nextTick(); // let the progress bar paint
        }
      };
      await Promise.all(Array.from({ length: toDrive ? 3 : 1 }, worker));
      if (toDrive) setStatus(`Done. ${participants.length} certificates uploaded to Google Drive.`);
      else {
        const [{ saveAs }, blob] = await Promise.all([import('file-saver'), zip.generateAsync({ type: 'blob', compression: 'STORE' })]);
        saveAs(blob, 'certificates.zip');
        setStatus(`Done. ${participants.length} certificates saved as certificates.zip.`);
      }
    } catch (e) { setStatus(e.message || 'Something went wrong. Try again.'); }
    finally { setGenerating(false); }
  };

  const preview = (f) => fieldText(f, null, nameColumn, emailColumn, sampleName);
  const ready = participants.length > 0 && !generating;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><FileCheck2 size={19} /></div>
          <div className="brand-name">CertiFlow</div>
        </div>
        <div className="top-actions">
          <button className="btn btn-soft" onClick={() => setShowDrive(true)}><CloudUpload size={16} /> <span className="btn-label">Google Drive</span></button>
          <button className="btn btn-dark" disabled={generating} onClick={() => generate(false)}><Download size={16} /> <span className="btn-label">Generate PDFs</span></button>
        </div>
      </header>

      <main className="workspace">
        <section className="editor-area" onPointerDown={(e) => { if (!e.target.closest('.canvas-text')) setSelected(null); }}>
          <div className="editor-heading">
            <div>
              <h1>Certificate editor</h1>
              <p>Place your text on the template, style it, then generate every certificate at once.</p>
            </div>
            <button className="btn btn-outline" onClick={() => fileInput.current?.click()}><Upload size={16} /> {template ? 'Replace template' : 'Upload template'}</button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { onTemplate(e.target.files?.[0]); e.target.value = ''; }} />
          </div>

          <div className="canvas-toolbar">
            <div className="canvas-label"><span className="canvas-dot" /> Live preview</div>
            <div className="canvas-hint"><MousePointer2 size={14} /> Drag to move, arrow keys to nudge, drag a corner to resize</div>
          </div>

          <div className="canvas-stage">
            {template ? (
              <div className="certificate" ref={canvasRef} style={{ '--ar': template.width / template.height }}>
                <img src={template.url} className="template-img" alt="Certificate template" draggable="false" />
                {fields.map((f) => (
                  <CanvasText key={f.id} f={f} text={preview(f)} selected={selected === f.id} templateWidth={template.width} onPointerDown={onPointerDown} onResizeStart={onResizeStart} />
                ))}
                {guides.v && <span className="guide guide-v" />}
                {guides.h && <span className="guide guide-h" />}
              </div>
            ) : (
              <div className="empty-canvas">
                <div className="empty-icon"><FileImage size={28} /></div>
                <h3>Start with your certificate design</h3>
                <p>Drag and drop a PNG, JPG or WEBP image here, or choose a file. High-resolution artwork gives the sharpest PDFs.</p>
                <button className="btn btn-dark" onClick={() => fileInput.current?.click()}><Upload size={16} /> Upload template</button>
              </div>
            )}
          </div>

          <div className="bottom-bar">
            <div className="bottom-info">
              <span className="tiny-icon"><Type size={15} /></span>
              <span>{fields.length} text layer{fields.length === 1 ? '' : 's'}</span>
              <span>{template ? `${template.width} × ${template.height} px` : 'No template yet'}</span>
            </div>
            <div className="sample-control">
              <label htmlFor="sample">Preview name</label>
              <input id="sample" value={sampleName} onChange={(e) => setSampleName(e.target.value)} />
            </div>
          </div>
        </section>

        <aside className="sidebar">
          <div className="side-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'style'} className={tab === 'style' ? 'active' : ''} onClick={() => setTab('style')}><Settings2 size={16} /> Design</button>
            <button role="tab" aria-selected={tab === 'data'} className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}><Users size={16} /> Participants</button>
          </div>

          {tab === 'style' ? (
            <div className="panel-content">
              <div className="panel-title-row">
                <h2>Text layers</h2>
                <button className="icon-btn" onClick={addField} title="Add text layer" aria-label="Add text layer"><Plus size={18} /></button>
              </div>
              <div className="layer-list">
                {fields.map((f) => (
                  <div key={f.id} className={`layer-item${selected === f.id ? ' chosen' : ''}`}>
                    <button className="layer-select" onClick={() => setSelected(f.id)}>
                      <span className="layer-type"><Type size={15} /></span>
                      <span className="layer-name">{f.label}</span>
                    </button>
                    <button className="layer-remove" aria-label={`Remove ${f.label}`} title="Remove layer" onClick={() => removeField(f.id)}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>

              {field ? (<>
              <div className="form-section">
                <label className="field-label" htmlFor="lname">Layer name</label>
                <input id="lname" className="control" value={field.label} onChange={(e) => updateField({ label: e.target.value })} />
                <label className="field-label" htmlFor="ltext">Text</label>
                <textarea id="ltext" className="control textarea" value={field.text} onChange={(e) => updateField({ text: e.target.value })} />
                <div className="helper">Use <code>{'{{name}}'}</code> for the participant’s name and <code>{'{{email}}'}</code> for their email. Press Enter for a new line.</div>
              </div>

              <div className="form-section">
                <div className="section-head">
                  <span className="section-label">Typography</span>
                  <button className="text-action" onClick={() => fontInput.current?.click()}>Add font</button>
                  <input ref={fontInput} hidden type="file" accept=".ttf,.otf,.woff" onChange={(e) => { onFont(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
                <label className="field-label" htmlFor="lfont">Font</label>
                <div className="select-wrap">
                  <select id="lfont" className="control" value={field.font} onChange={(e) => updateField({ font: e.target.value })}>
                    {fontNames.map((n) => <option key={n}>{n}</option>)}
                  </select>
                  <ChevronDown size={15} />
                </div>
                <div className="two-col">
                  <div>
                    <label className="field-label" htmlFor="lsize">Size</label>
                    <div className="number-control"><input id="lsize" type="number" min="6" max="300" value={field.size} onChange={(e) => updateField({ size: clamp(Number(e.target.value), 6, 300) })} /><span>px</span></div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="lcolor">Colour</label>
                    <div className="color-control"><input id="lcolor" type="color" value={field.color} onChange={(e) => updateField({ color: e.target.value })} /><span>{field.color}</span></div>
                  </div>
                </div>
                <div className="style-tools">
                  <button aria-label="Bold" aria-pressed={field.bold} disabled={!!fontFiles[field.font]} className={field.bold ? 'tool-active' : ''} onClick={() => updateField({ bold: !field.bold })}><Bold size={16} /></button>
                  <button aria-label="Italic" aria-pressed={field.italic} disabled={!!fontFiles[field.font]} className={field.italic ? 'tool-active' : ''} onClick={() => updateField({ italic: !field.italic })}><Italic size={16} /></button>
                  <span className="tool-divider" />
                  {[['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]].map(([a, Icon]) => (
                    <button key={a} aria-label={`Align ${a}`} aria-pressed={field.align === a} className={field.align === a ? 'tool-active' : ''} onClick={() => updateField({ align: a })}><Icon size={16} /></button>
                  ))}
                </div>
                <div className="helper">Alignment sets which point of the text sits at the position below. Bold and italic apply to built-in fonts only.</div>
              </div>

              <div className="form-section">
                <div className="section-head">
                  <span className="section-label">Position</span>
                  <button className="text-action" onClick={() => updateField({ x: 0.5, y: 0.5 })}>Centre</button>
                </div>
                <div className="two-col">
                  {[['x', 'Horizontal'], ['y', 'Vertical']].map(([k, label]) => (
                    <div key={k}>
                      <label className="field-label" htmlFor={`p${k}`}>{label}</label>
                      <div className="number-control"><input id={`p${k}`} type="number" min="0" max="100" value={Math.round(field[k] * 100)} onChange={(e) => updateField({ [k]: clamp(Number(e.target.value), 0, 100) / 100 })} /><span>%</span></div>
                    </div>
                  ))}
                </div>
                <div className="helper">Arrow keys move the text, Shift makes bigger steps and Delete removes it. Drag a corner on the template to resize. A pink line appears when the text is centred.</div>
                <button className="delete-layer" onClick={() => removeField(field.id)}><Trash2 size={14} /> Remove this layer</button>
              </div>
              </>) : (
                <p className="empty-hint">{fields.length ? 'Select a text layer on the template or from the list to edit it.' : 'No text layers yet. Use the + button to add one.'}</p>
              )}
            </div>
          ) : (
            <div className="panel-content">
              <h2>Participant data</h2>
              <p className="panel-desc">Import an Excel or CSV file. Each row becomes one PDF.</p>
              <button className="upload-sheet" onClick={() => sheetInput.current?.click()}>
                <div className="sheet-icon"><FileSpreadsheet size={22} /></div>
                <div><strong>{sheetName || 'Upload participant list'}</strong><span>{participants.length ? `${participants.length} participants` : '.xlsx, .xls or .csv'}</span></div>
                <Upload size={17} />
              </button>
              <input ref={sheetInput} hidden type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { onSheet(e.target.files?.[0]); e.target.value = ''; }} />

              {columns.length > 0 && (
                <>
                  <div className="form-section">
                    <label className="field-label" htmlFor="ncol">Name column</label>
                    <div className="select-wrap">
                      <select id="ncol" className="control" value={nameColumn} onChange={(e) => setNameColumn(e.target.value)}>{columns.map((c) => <option key={c}>{c}</option>)}</select>
                      <ChevronDown size={15} />
                    </div>
                    <label className="field-label" htmlFor="ecol">Email column <span className="optional">optional</span></label>
                    <div className="select-wrap">
                      <select id="ecol" className="control" value={emailColumn} onChange={(e) => setEmailColumn(e.target.value)}>
                        <option value="">Not used</option>{columns.map((c) => <option key={c}>{c}</option>)}
                      </select>
                      <ChevronDown size={15} />
                    </div>
                  </div>
                  <div className="preview-rows">
                    <div className="preview-head">First 3 rows</div>
                    {participants.slice(0, 3).map((p, i) => (
                      <div className="preview-row" key={i}><span>{String(p[nameColumn] || 'Unnamed')}</span><span>{emailColumn ? String(p[emailColumn] || '—') : ''}</span></div>
                    ))}
                  </div>
                </>
              )}

              <div className="data-tip"><strong>Spreadsheet tip</strong><p>Put headers in the first row, such as Name and Email. Only the first sheet is read.</p></div>
              <button className="btn btn-dark full-btn" disabled={!ready} onClick={() => generate(false)}><Download size={16} /> Download ZIP</button>
              <button className="btn btn-drive full-btn" disabled={!ready} onClick={() => setShowDrive(true)}><CloudUpload size={16} /> Upload to Google Drive</button>
            </div>
          )}
        </aside>
      </main>

      {dropActive && (
        <div className="drop-overlay"><strong>Drop to upload</strong><span>Images become the template. Excel and CSV files become the participant list.</span></div>
      )}

      {status && (
        <div className="status-toast" role="status">
          <span className={generating ? 'status-spinner' : ''}>{generating ? <LoaderCircle size={15} /> : <Check size={15} />}</span>
          <span>{status}</span>
          {generating && <span className="progress-mini">{progress}%</span>}
          <button aria-label="Dismiss" onClick={() => setStatus('')}><X size={14} /></button>
        </div>
      )}
      {generating && <div className="progress-line"><span style={{ width: `${progress}%` }} /></div>}

      {showDrive && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowDrive(false); }}>
          <div className="drive-modal" role="dialog" aria-modal="true" aria-labelledby="drive-title">
            <div className="modal-head">
              <div className="drive-modal-icon"><CloudUpload size={20} /></div>
              <button className="icon-btn" aria-label="Close" onClick={() => setShowDrive(false)}><X size={18} /></button>
            </div>
            <h2 id="drive-title">Upload to Google Drive</h2>
            <p>Each certificate is saved as a PDF in the folder you choose.</p>
            <label className="field-label" htmlFor="cid">Google OAuth client ID</label>
            <input id="cid" className="control" placeholder="xxxx.apps.googleusercontent.com" value={clientId} onChange={(e) => { setClientId(e.target.value); safeStore.set('cf-google-client', e.target.value); }} />
            <div className="helper">Create a Web application client in Google Cloud Console, enable the Drive API and add this site’s address as an authorised JavaScript origin.</div>
            <label className="field-label" htmlFor="durl">Drive folder link</label>
            <input id="durl" className="control" placeholder="https://drive.google.com/drive/folders/…" value={driveUrl} onChange={(e) => setDriveUrl(e.target.value)} />
            <div className="drive-note"><FolderOpen size={16} /><span>Files are named <b>Participant Name.pdf</b>. Existing files with the same name are not replaced.</span></div>
            <div className="modal-actions">
              <button className="btn btn-soft" onClick={() => setShowDrive(false)}>Cancel</button>
              <button className="btn btn-dark" disabled={generating} onClick={() => { setShowDrive(false); generate(true); }}><CloudUpload size={16} /> Generate and upload</button>
            </div>
            <a className="setup-link" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer"><Link2 size={13} /> Open Google Cloud credentials</a>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);