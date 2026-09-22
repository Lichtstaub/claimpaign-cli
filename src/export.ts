import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

/** A code and the single URI that gets embedded in its QR image or PDF card. */
export interface ExportItem {
  code: string;
  uri: string;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const COLS = 3;
const ROWS = 4;
const PER_PAGE = COLS * ROWS;
const MARGIN = 36;
const QR_SIZE = 120;

/**
 * Replaces every character outside the WinAnsi printable range with "?", so text drawn
 * with a pdf-lib standard font never throws on a character such as an emoji, which the
 * standard fonts cannot encode.
 */
function toWinAnsi(text: string): string {
  return Array.from(text).map(ch => {
    const code = ch.codePointAt(0) ?? 0;
    return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) ? ch : '?';
  }).join('');
}

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}

function ensureDirFor(path: string): void {
  const dir = dirname(path);
  if (dir) mkdirSync(dir, { recursive: true });
}

/**
 * Writes a CSV file. Pass columns explicitly to fix the header and its order, including
 * for an empty result, which still gets a header line with no rows under it. Without
 * columns, the header falls back to the keys of the first row, and an empty result
 * writes an empty file since there are no keys to take a header from. A field is quoted
 * when it contains a comma, quote or newline.
 */
export function writeCsv(path: string, rows: Record<string, string>[], columns?: string[]): void {
  ensureDirFor(path);
  const keys = columns ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
  if (keys.length === 0) {
    writeFileSync(path, '');
    return;
  }
  const lines = [keys.map(csvField).join(',')];
  for (const row of rows) lines.push(keys.map(k => csvField(row[k] ?? '')).join(','));
  writeFileSync(path, lines.join('\n') + '\n');
}

/** Writes one QR PNG per item into dir, named <code>.png. */
export async function writeQrImages(dir: string, items: ExportItem[]): Promise<void> {
  mkdirSync(dir, { recursive: true });
  for (const item of items) {
    await QRCode.toFile(join(dir, `${item.code}.png`), item.uri, { width: 512, margin: 2 });
  }
}

function drawCard(page: PDFPage, qrImage: Awaited<ReturnType<PDFDocument['embedPng']>>, code: string, title: string, monoFont: PDFFont, titleFont: PDFFont, cellX: number, cellTop: number, cellWidth: number): void {
  const qrX = cellX + (cellWidth - QR_SIZE) / 2;
  const qrY = cellTop - QR_SIZE - 12;
  page.drawImage(qrImage, { x: qrX, y: qrY, width: QR_SIZE, height: QR_SIZE });

  const safeCode = toWinAnsi(code);
  const codeSize = 10;
  const codeWidth = monoFont.widthOfTextAtSize(safeCode, codeSize);
  page.drawText(safeCode, { x: cellX + (cellWidth - codeWidth) / 2, y: qrY - 14, size: codeSize, font: monoFont });

  const safeTitle = toWinAnsi(title);
  const titleSize = 7;
  const titleWidth = titleFont.widthOfTextAtSize(safeTitle, titleSize);
  page.drawText(safeTitle, { x: cellX + (cellWidth - titleWidth) / 2, y: qrY - 26, size: titleSize, font: titleFont });
}

/**
 * Writes a plain A4 cut-sheet PDF, 3 columns by 4 rows of cards per page. Each card has
 * a QR code, the full code below it in Courier, and the campaign title in small print
 * under that. This is a work document meant for cutting apart, not a designed handout.
 */
export async function writePdf(path: string, items: ExportItem[], title: string): Promise<void> {
  ensureDirFor(path);

  const doc = await PDFDocument.create();
  const monoFont = await doc.embedFont(StandardFonts.Courier);
  const titleFont = await doc.embedFont(StandardFonts.Helvetica);

  const cellWidth = (PAGE_WIDTH - 2 * MARGIN) / COLS;
  const cellHeight = (PAGE_HEIGHT - 2 * MARGIN) / ROWS;

  let page: PDFPage | undefined;
  let onPage = 0;

  for (const item of items) {
    if (!page || onPage === PER_PAGE) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      onPage = 0;
    }
    const col = onPage % COLS;
    const row = Math.floor(onPage / COLS);
    const cellX = MARGIN + col * cellWidth;
    const cellTop = PAGE_HEIGHT - MARGIN - row * cellHeight;

    const qrBuffer = await QRCode.toBuffer(item.uri, { width: 256, margin: 1 });
    const qrImage = await doc.embedPng(qrBuffer);
    drawCard(page, qrImage, item.code, title, monoFont, titleFont, cellX, cellTop, cellWidth);

    onPage += 1;
  }

  const bytes = await doc.save();
  writeFileSync(path, bytes);
}
