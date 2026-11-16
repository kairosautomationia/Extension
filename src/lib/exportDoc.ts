/**
 * Exportar lo que escribe Hanzo a archivos (PDF, Word, Excel, CSV, Markdown).
 * Todo se genera aquí, en la extensión, sin librerías ni servidores: nada sale del navegador.
 */

export type Block =
  | { t: 'h'; l: 1 | 2 | 3; text: string }
  | { t: 'p'; text: string }
  | { t: 'li'; text: string; n?: number }
  | { t: 'table'; rows: string[][]; title?: string };

export type ExportFormat = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'md';

export interface ExportFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

const enc = new TextEncoder();

/* ---------------- Markdown → bloques ---------------- */

function splitRow(s: string): string[] {
  const core = s.replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < core.length; i++) {
    const c = core[i];
    if (c === '\\' && core[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const isSep = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));

/** Quita las marcas de formato en línea (**negrita**, *cursiva*, `código`, [texto](url)). */
export function plain(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\s][^*]*)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)');
}

/** Divide un texto en tramos con y sin negrita. */
function runs(s: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const t = s.replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)');
  for (const part of t.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) out.push({ text: part.slice(2, -2), bold: true });
    else out.push({ text: part.replace(/\*([^*\s][^*]*)\*/g, '$1'), bold: false });
  }
  return out;
}

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  let lastHeading = '';
  const flush = () => {
    if (para.length) {
      out.push({ t: 'p', text: para.join(' ') });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (!s) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(s);
    if (h) {
      flush();
      lastHeading = plain(h[2]);
      out.push({ t: 'h', l: Math.min(3, h[1].length) as 1 | 2 | 3, text: h[2] });
      continue;
    }
    if (s.startsWith('|')) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitRow(lines[i].trim());
        if (!isSep(cells)) rows.push(cells);
        i++;
      }
      i--;
      if (rows.length) out.push({ t: 'table', rows, title: lastHeading || undefined });
      continue;
    }
    if (/^```/.test(s)) continue;
    const li = /^(?:[-*•]\s+|(\d+)[.)]\s+)(.*)$/.exec(s);
    if (li) {
      flush();
      out.push({ t: 'li', text: li[2], n: li[1] ? Number(li[1]) : undefined });
      continue;
    }
    para.push(s);
  }
  flush();
  return out;
}

/** Texto de una tabla en Markdown (las barras y saltos de línea de las celdas se neutralizan). */
export function tableToMarkdown(rows: string[][], maxRows = Infinity): string {
  if (rows.length === 0) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const cell = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  const line = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => cell(r[i] ?? '')).join(' | ')} |`;
  const body = rows.slice(1, maxRows + 1).map(line);
  return [line(rows[0]), `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`, ...body].join('\n');
}

/* ---------------- Nombres ---------------- */

const today = () => new Date().toISOString().slice(0, 10);

function slug(s: string): string {
  const t = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return t || 'respuesta';
}

function baseName(md: string): string {
  const blocks = parseMarkdown(md);
  const h = blocks.find((b) => b.t === 'h') as { text: string } | undefined;
  const first = blocks.find((b) => b.t === 'p' || b.t === 'li') as { text: string } | undefined;
  const from = h ? plain(h.text) : plain(first?.text ?? '').split(/\s+/).slice(0, 6).join(' ');
  return `hanzo-${slug(from)}-${today()}`;
}

/* ---------------- Utilidades binarias ---------------- */

let CRC: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** ZIP sin compresión (suficiente para .xlsx y .docx). */
export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, size, true);
    l.setUint32(22, size, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const c = new DataView(cen.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, size, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    cen.set(name, 46);
    chunks.push(local, f.data);
    central.push(cen);
    offset += local.length + size;
  }
  const cd = concat(central);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cd.length, true);
  e.setUint32(16, offset, true);
  return concat([...chunks, cd, end]);
}

const xml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const file = (name: string, text: string) => ({ name, data: enc.encode(text) });

/* ---------------- CSV ---------------- */

/** Evita que Excel tome un texto de la página como fórmula. */
const safeCell = (s: string) => (/^[=@]/.test(s) || /^[+-][^\d\s.,]/.test(s) ? `'${s}` : s);

export function toCsv(tables: string[][][]): Uint8Array {
  const sep = ';'; // Excel en español usa ";" como separador de lista
  const q = (s: string) => {
    const v = safeCell(s);
    return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const lines: string[] = [];
  tables.forEach((rows, i) => {
    if (i > 0) lines.push('');
    for (const r of rows) lines.push(r.map(q).join(sep));
  });
  return enc.encode('﻿' + lines.join('\r\n') + '\r\n');
}

/* ---------------- Excel (.xlsx) ---------------- */

export interface Sheet {
  name: string;
  rows: string[][];
  header?: boolean;
}

const colName = (n: number) => {
  let s = '';
  for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const NUM = /^-?(0|[1-9]\d{0,14})(\.\d+)?$/;

function sheetName(raw: string, used: Set<string>, i: number): string {
  let n = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').slice(0, 31) || `Tabla ${i + 1}`;
  let k = 2;
  const base = n;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${k++}`;
  used.add(n.toLowerCase());
  return n;
}

export function toXlsx(sheets: Sheet[]): Uint8Array {
  const used = new Set<string>();
  const list = (sheets.length ? sheets : [{ name: 'Hoja 1', rows: [['']] }]).map((s, i) => ({ ...s, name: sheetName(s.name, used, i) }));
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const files = [
    file(
      '[Content_Types].xml',
      HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>',
    ),
    file(
      '_rels/.rels',
      HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    file(
      'xl/workbook.xml',
      HEAD +
        `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        list.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    ),
    file(
      'xl/_rels/workbook.xml.rels',
      HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        list
          .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
          .join('') +
        `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    file(
      'xl/styles.xml',
      HEAD +
        `<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFECE6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ),
  ];
  list.forEach((s, si) => {
    const cols = Math.max(1, ...s.rows.map((r) => r.length));
    const widths = Array.from({ length: cols }, (_, c) => {
      let w = 8;
      for (const r of s.rows.slice(0, 200)) w = Math.max(w, Math.min(60, (r[c] ?? '').length + 2));
      return w;
    });
    const header = s.header !== false && s.rows.length > 1;
    const rows = s.rows
      .map((r, ri) => {
        const cells = r
          .map((v, ci) => {
            const ref = `${colName(ci)}${ri + 1}`;
            const st = header && ri === 0 ? ' s="1"' : '';
            if (v === '') return st ? `<c r="${ref}"${st}/>` : '';
            if (NUM.test(v) && !(header && ri === 0)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
            return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
          })
          .join('');
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join('');
    files.push(
      file(
        `xl/worksheets/sheet${si + 1}.xml`,
        HEAD +
          `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ''}>` +
          (header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '') +
          '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>' +
          widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') +
          `</cols><sheetData>${rows}</sheetData></worksheet>`,
      ),
    );
  });
  return zip(files);
}

/* ---------------- Word (.docx) ---------------- */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const wRuns = (text: string, extra = '') =>
  runs(text)
    .map((r) => `<w:r><w:rPr>${r.bold || extra.includes('b') ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`)
    .join('');

export function toDocx(blocks: Block[]): Uint8Array {
  const body: string[] = [];
  for (const b of blocks) {
    if (b.t === 'h') body.push(`<w:p><w:pPr><w:pStyle w:val="Heading${b.l}"/></w:pPr>${wRuns(b.text)}</w:p>`);
    else if (b.t === 'p') body.push(`<w:p>${wRuns(b.text)}</w:p>`);
    else if (b.t === 'li')
      body.push(
        `<w:p><w:pPr><w:ind w:left="567" w:hanging="283"/></w:pPr><w:r><w:t xml:space="preserve">${b.n ? `${b.n}.` : '•'} </w:t></w:r>${wRuns(b.text)}</w:p>`,
      );
    else {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const grid = Array.from({ length: cols }, () => `<w:gridCol w:w="${Math.floor(9638 / cols)}"/>`).join('');
      const trs = b.rows
        .map((r, ri) => {
          const tcs = Array.from({ length: cols }, (_, ci) => {
            const shade = ri === 0 && b.rows.length > 1 ? '<w:shd w:val="clear" w:color="auto" w:fill="EFECE6"/>' : '';
            return `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9638 / cols)}" w:type="dxa"/>${shade}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${wRuns(r[ci] ?? '', ri === 0 && b.rows.length > 1 ? 'b' : '')}</w:p></w:tc>`;
          }).join('');
          return `<w:tr>${ri === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${tcs}</w:tr>`;
        })
        .join('');
      body.push(
        `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
          .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BFBBB2"/>`)
          .join('')}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs}</w:tbl><w:p/>`,
      );
    }
  }
  if (body.length === 0) body.push('<w:p/>');
  const heading = (id: string, name: string, size: number, before: number) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  return zip([
    file(
      '[Content_Types].xml',
      HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    ),
    file(
      '_rels/.rels',
      HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    file(
      'word/_rels/document.xml.rels',
      HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
    file(
      'word/styles.xml',
      HEAD +
        `<w:styles xmlns:w="${W_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="es-EC"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading('Heading1', 'heading 1', 36, 240)}${heading('Heading2', 'heading 2', 30, 200)}${heading('Heading3', 'heading 3', 26, 160)}</w:styles>`,
    ),
    file(
      'word/document.xml',
      HEAD +
        `<w:document xmlns:w="${W_NS}"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    ),
  ]);
}

/* ---------------- PDF ---------------- */

// Anchos de Helvetica (milésimas de em) para los códigos 32–126
const HW = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584,
  556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278,
  469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260,
  334, 584,
];

const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x2026: 0x85, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2122: 0x99,
};

/** Código WinAnsi de un carácter, o -1 si el PDF estándar no lo puede mostrar (emojis, otros alfabetos). */
function ansi(ch: string): number {
  const c = ch.codePointAt(0) ?? 63;
  if (c === 9 || c === 10 || c === 13 || c === 0xa0) return 32;
  if (c < 32) return -1;
  if (c <= 126 || (c >= 0xa0 && c <= 0xff)) return c;
  return CP1252[c] ?? -1;
}

const cw = (code: number) => (code >= 32 && code <= 126 ? HW[code - 32] : code === 0x95 ? 350 : code >= 0x80 && code < 0xc0 ? 556 : 590);

function toAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ansi(ch);
    if (c >= 0) out.push(c);
  }
  return out;
}

const textWidth = (codes: number[], size: number, bold: boolean) => (codes.reduce((n, c) => n + cw(c), 0) * size * (bold ? 1.05 : 1)) / 1000;

interface Token {
  codes: number[];
  bold: boolean;
}
/** Una palabra: uno o más tramos pegados (p.ej. «**Descargar**:» son dos tramos sin espacio entre ellos). */
type Group = Token[];
type Line = Group[];

const groupWidth = (g: Group, size: number) => g.reduce((n, t) => n + textWidth(t.codes, size, t.bold), 0);

/** Parte un texto con negritas en líneas que caben en `maxW` puntos. */
function wrap(text: string, size: number, maxW: number, forceBold = false, maxLines = 400): Line[] {
  const groups: Group[] = [];
  let attach = false;
  for (const r of runs(text)) {
    for (const part of r.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        attach = false;
        continue;
      }
      const codes = toAnsi(part);
      if (!codes.length) continue;
      const tok = { codes, bold: r.bold || forceBold };
      if (attach && groups.length) groups[groups.length - 1].push(tok);
      else groups.push([tok]);
      attach = true;
    }
  }
  const lines: Line[] = [];
  let cur: Line = [];
  let curW = 0;
  const space = (cw(32) * size) / 1000;
  const push = () => {
    if (cur.length) lines.push(cur);
    cur = [];
    curW = 0;
  };
  for (const g0 of groups) {
    let g = g0;
    // Palabra más ancha que la línea: se corta
    while (groupWidth(g, size) > maxW && g.length === 1 && g[0].codes.length > 1) {
      const t = g[0];
      let n = t.codes.length - 1;
      while (n > 1 && textWidth(t.codes.slice(0, n), size, t.bold) > maxW) n--;
      push();
      lines.push([[{ codes: t.codes.slice(0, n), bold: t.bold }]]);
      g = [{ codes: t.codes.slice(n), bold: t.bold }];
    }
    const gw = groupWidth(g, size);
    if (cur.length && curW + space + gw > maxW) push();
    curW += (cur.length ? space : 0) + gw;
    cur.push(g);
    if (lines.length >= maxLines) break;
  }
  push();
  return lines;
}

const lit = (codes: number[]) =>
  '(' +
  codes
    .map((c) => (c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : c < 32 || c > 126 ? '\\' + c.toString(8).padStart(3, '0') : String.fromCharCode(c)))
    .join('') +
  ')';

const n2 = (n: number) => (Math.round(n * 100) / 100).toString();

export function toPdf(blocks: Block[]): Uint8Array {
  const PW = 595.28;
  const PH = 841.89;
  const M = 56;
  const BOTTOM = PH - 60;
  const contentW = PW - 2 * M;
  const pages: string[][] = [[]];
  let y = M;
  const out = () => pages[pages.length - 1];
  const newPage = () => {
    pages.push([]);
    y = M;
  };
  /** Dibuja una línea (con tramos en negrita) con su base en `top + size`. */
  const drawLine = (line: Line, x: number, top: number, size: number) => {
    const items: { codes: number[]; bold: boolean; sp: boolean }[] = [];
    line.forEach((g, gi) => g.forEach((t, ti) => items.push({ codes: t.codes, bold: t.bold, sp: gi > 0 && ti === 0 })));
    let cx = x;
    let i = 0;
    while (i < items.length) {
      const bold = items[i].bold;
      if (items[i].sp) cx += (cw(32) * size) / 1000;
      let j = i;
      const seg: number[] = [];
      while (j < items.length && items[j].bold === bold) {
        if (j > i && items[j].sp) seg.push(32);
        seg.push(...items[j].codes);
        j++;
      }
      out().push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${n2(cx)} ${n2(PH - top - size)} Td ${lit(seg)} Tj ET`);
      cx += textWidth(seg, size, bold);
      i = j;
    }
  };
  /** Escribe un texto con saltos de línea y de página; devuelve dónde quedó su primera línea (o -1 si no hay texto). */
  const flow = (text: string, size: number, lead: number, indent = 0, bold = false, before = 0, after = 0): number => {
    const lines = wrap(text, size, contentW - indent, bold);
    if (!lines.length) return -1;
    y += before;
    let first = -1;
    for (const ln of lines) {
      if (y + lead > BOTTOM) newPage();
      if (first < 0) first = y;
      drawLine(ln, M + indent, y, size);
      y += lead;
    }
    y += after;
    return first;
  };

  for (const b of blocks) {
    if (b.t === 'h') flow(b.text, b.l === 1 ? 20 : b.l === 2 ? 16 : 13, b.l === 1 ? 26 : b.l === 2 ? 21 : 17, 0, true, b.l === 1 ? 4 : 8, 4);
    else if (b.t === 'p') flow(b.text, 11, 15, 0, false, 0, 6);
    else if (b.t === 'li') {
      const top = flow(b.text, 11, 15, 16, false, 0, 3);
      if (top >= 0) drawLine([[{ codes: toAnsi(b.n ? `${b.n}.` : '•'), bold: false }]], M, top, 11);
    } else {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const weights = Array.from({ length: cols }, (_, c) => {
        let m = 4;
        for (const r of b.rows.slice(0, 100)) m = Math.max(m, Math.min(36, (r[c] ?? '').length));
        return Math.sqrt(m);
      });
      const sum = weights.reduce((a, c) => a + c, 0);
      const widths = weights.map((w) => (w / sum) * contentW);
      const xs = widths.map((_, i) => M + widths.slice(0, i).reduce((a, c) => a + c, 0));
      const size = cols > 6 ? 8 : 9;
      const lead = size + 3.5;
      y += 2;
      b.rows.forEach((r, ri) => {
        const head = ri === 0 && b.rows.length > 1;
        const cells = Array.from({ length: cols }, (_, c) => wrap(r[c] ?? '', size, widths[c] - 6, head, 30));
        const h = Math.max(1, ...cells.map((c) => c.length)) * lead + 5;
        if (y + h > BOTTOM) newPage();
        if (head) out().push(`0.937 0.925 0.902 rg ${n2(M)} ${n2(PH - y - h)} ${n2(contentW)} ${n2(h)} re f 0 g`);
        out().push('0.75 0.73 0.70 RG 0.5 w');
        cells.forEach((lines, c) => {
          out().push(`${n2(xs[c])} ${n2(PH - y - h)} ${n2(widths[c])} ${n2(h)} re S`);
          lines.forEach((ln, li) => drawLine(ln, xs[c] + 3, y + 3 + li * lead, size));
        });
        y += h;
      });
      y += 10;
    }
  }

  // Pie de página con numeración
  pages.forEach((p, i) => {
    const t = toAnsi(`Hanzo · página ${i + 1} de ${pages.length}`);
    p.push(`0.5 g BT /F1 8 Tf ${n2(M)} 30 Td ${lit(t)} Tj ET 0 g`);
  });

  const objs: string[] = [];
  const add = (s: string) => objs.push(s) && objs.length;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((p, i) => {
    const stream = p.join('\n');
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

/* ---------------- Punto de entrada ---------------- */

/** Tablas de un texto Markdown, con el título (encabezado previo) como nombre de hoja. */
export function tablesOf(md: string): { name: string; rows: string[][] }[] {
  return parseMarkdown(md)
    .filter((b): b is Extract<Block, { t: 'table' }> => b.t === 'table')
    .map((b, i) => ({ name: b.title ?? `Tabla ${i + 1}`, rows: b.rows.map((r) => r.map(plain)) }));
}

/** Sin tablas: cada párrafo o elemento de lista pasa a ser una fila de una sola columna. */
function textRows(md: string): string[][] {
  const rows = parseMarkdown(md)
    .filter((b) => b.t !== 'table')
    .map((b) => [plain((b as { text: string }).text)]);
  return rows.length ? rows : [['']];
}

export function buildExport(md: string, fmt: ExportFormat): ExportFile {
  const base = baseName(md);
  if (fmt === 'md') return { name: `${base}.md`, mime: 'text/markdown', bytes: enc.encode(md) };
  if (fmt === 'pdf') return { name: `${base}.pdf`, mime: 'application/pdf', bytes: toPdf(parseMarkdown(md)) };
  if (fmt === 'docx')
    return {
      name: `${base}.docx`,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: toDocx(parseMarkdown(md)),
    };
  const tables = tablesOf(md);
  if (fmt === 'csv')
    return { name: `${base}.csv`, mime: 'text/csv', bytes: toCsv(tables.length ? tables.map((t) => t.rows) : [textRows(md)]) };
  return {
    name: `${base}.xlsx`,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: toXlsx(tables.length ? tables : [{ name: 'Texto', rows: textRows(md), header: false }]),
  };
}

/** Entrega un archivo al usuario (descarga del navegador). */
export function downloadFile(f: { name: string; mime: string; bytes: Uint8Array | string }): void {
  const blob = new Blob([f.bytes as BlobPart], { type: f.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
