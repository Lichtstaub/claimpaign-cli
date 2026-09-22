import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { startFakeApi, fakeKey, type FakeReq } from './helpers/fake-api.js';
import { writeCsv, writeQrImages, writePdf } from '../src/export.js';
import { campaignCodes, buildExportItems } from '../src/commands/campaign-codes.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const TOKEN = fakeKey('export');

let dir: string;
let output: string[];

beforeEach(() => {
  output = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => { output.push(String(chunk)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  dir = mkdtempSync(join(tmpdir(), 'cp-export-'));
  process.env.CLAIMPAIGN_TOKEN = TOKEN;
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.CLAIMPAIGN_TOKEN;
});

describe('writeCsv', () => {
  it('writes an exact header and rows from the keys of the first row', () => {
    const path = join(dir, 'codes.csv');
    writeCsv(path, [
      { code: 'AAA_0000000001', status: 'unclaimed', claim_uri: 'web+cardano://a', fallback_url: 'https://a' },
      { code: 'AAA_0000000002', status: 'claimed', claim_uri: 'web+cardano://b', fallback_url: 'https://b' },
    ]);
    const text = readFileSync(path, 'utf8');
    expect(text).toBe(
      'code,status,claim_uri,fallback_url\n' +
      'AAA_0000000001,unclaimed,web+cardano://a,https://a\n' +
      'AAA_0000000002,claimed,web+cardano://b,https://b\n',
    );
  });

  it('quotes a field that contains a comma, quote or newline', () => {
    const path = join(dir, 'quoted.csv');
    writeCsv(path, [{ code: 'X', status: 'a "quote", a comma\nand a newline', claim_uri: 'u', fallback_url: 'f' }]);
    const text = readFileSync(path, 'utf8');
    expect(text).toBe('code,status,claim_uri,fallback_url\nX,"a ""quote"", a comma\nand a newline",u,f\n');
  });

  it('still writes the header line for an empty result when columns are given explicitly', () => {
    const path = join(dir, 'empty.csv');
    writeCsv(path, [], ['code', 'status', 'claim_uri', 'fallback_url']);
    const text = readFileSync(path, 'utf8');
    expect(text).toBe('code,status,claim_uri,fallback_url\n');
  });
});

describe('buildExportItems', () => {
  const rows = [
    { code: 'AAA_0000000001', status: 'unclaimed', claim_uri: 'web+cardano://claim/v1?faucet_url=x&code=1', fallback_url: 'https://claimpaign.com/api/qr/AAA_0000000001' },
    { code: 'AAA_0000000002', status: 'claimed', claim_uri: 'web+cardano://claim/v1?faucet_url=x&code=2', fallback_url: 'https://claimpaign.com/api/qr/AAA_0000000002' },
  ];

  it('uses claim_uri as the uri when fallback is false', () => {
    const items = buildExportItems(rows, false);
    expect(items).toEqual([
      { code: 'AAA_0000000001', uri: rows[0].claim_uri },
      { code: 'AAA_0000000002', uri: rows[1].claim_uri },
    ]);
  });

  it('uses fallback_url as the uri when fallback is true', () => {
    const items = buildExportItems(rows, true);
    expect(items).toEqual([
      { code: 'AAA_0000000001', uri: rows[0].fallback_url },
      { code: 'AAA_0000000002', uri: rows[1].fallback_url },
    ]);
  });
});

describe('writeQrImages', () => {
  it('writes one PNG per code, named after the code, with the PNG signature', async () => {
    const qrDir = join(dir, 'qrcodes');
    await writeQrImages(qrDir, [
      { code: 'AAA_0000000001', uri: 'web+cardano://claim/v1?faucet_url=x&code=0000000001' },
      { code: 'AAA_0000000002', uri: 'web+cardano://claim/v1?faucet_url=x&code=0000000002' },
    ]);
    const files = readdirSync(qrDir).sort();
    expect(files).toEqual(['AAA_0000000001.png', 'AAA_0000000002.png']);
    for (const file of files) {
      const bytes = readFileSync(join(qrDir, file));
      expect(bytes.subarray(0, 4)).toEqual(PNG_SIGNATURE);
    }
  });
});

describe('writePdf', () => {
  it('starts with %PDF and lays out ceil(n / 12) pages for 13 items', async () => {
    const path = join(dir, 'codes.pdf');
    const items = Array.from({ length: 13 }, (_, i) => ({
      code: `AAA_${String(i + 1).padStart(10, '0')}`,
      uri: `web+cardano://claim/v1?faucet_url=x&code=${i + 1}`,
    }));
    await writePdf(path, items, 'My Campaign');

    const bytes = readFileSync(path);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(Math.ceil(13 / 12));
  });

  it('lays out exactly one page for a single item', async () => {
    const path = join(dir, 'single.pdf');
    await writePdf(path, [{ code: 'AAA_0000000001', uri: 'web+cardano://claim/v1?faucet_url=x&code=1' }], 'Shared Campaign');
    const bytes = readFileSync(path);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});

/** A minimal admin campaign GET fake, paginated by ?page, serving whatever code rows are given. */
async function startCodesFake(params: {
  id: string; name: string; codeMode: string; codePrefix: string;
  pages: { code: string; status: string }[][];
}) {
  const { id, name, codeMode, codePrefix, pages } = params;
  const api = await startFakeApi({
    [`GET /api/admin/campaign/${id}`]: (req: FakeReq) => {
      const page = Number(req.url.searchParams.get('page') || '1');
      const rows = pages[page - 1] ?? [];
      const total = pages.reduce((sum, p) => sum + p.length, 0);
      return {
        status: 200,
        body: {
          campaign: {
            id, name, status: 'active', code_prefix: codePrefix, code_mode: codeMode,
            total_codes: total, codes_claimed: 0, created_at: '2026-01-01T00:00:00Z',
          },
          codes: rows.map(r => ({ code: r.code, status: r.status, address: null, claim_status: null, claimed_at: null, tx_hash: null })),
          queue: { pending: 0, queued: 0, processing: 0 },
          pagination: { total, page, limit: 200, pages: pages.length },
        },
      };
    },
  });
  return api;
}

describe('campaign codes', () => {
  it('loads every page and deduplicates unique codes, excluding claimed ones by default', async () => {
    const fake = await startCodesFake({
      id: 'camp-pages', name: 'Pages', codeMode: 'unique', codePrefix: 'PAGE1',
      pages: [
        [{ code: 'PAGE1_0000000001', status: 'unclaimed' }, { code: 'PAGE1_0000000002', status: 'claimed' }],
        [{ code: 'PAGE1_0000000003', status: 'unclaimed' }],
      ],
    });

    const csv = join(dir, 'pages.csv');
    await campaignCodes('camp-pages', { api: fake.url, json: false, csv });
    await fake.close();

    const rows = readFileSync(csv, 'utf8').trim().split('\n');
    expect(rows[0]).toBe('code,status,claim_uri,fallback_url');
    expect(rows.length).toBe(3); // header + 2 unclaimed codes
    expect(rows.some(r => r.startsWith('PAGE1_0000000002'))).toBe(false);
    expect(fake.calls.filter(c => c.method === 'GET').length).toBe(2);
  });

  it('includes claimed codes with --all', async () => {
    const fake = await startCodesFake({
      id: 'camp-all', name: 'All', codeMode: 'unique', codePrefix: 'ALLX1',
      pages: [[{ code: 'ALLX1_0000000001', status: 'unclaimed' }, { code: 'ALLX1_0000000002', status: 'claimed' }]],
    });

    const csv = join(dir, 'all.csv');
    await campaignCodes('camp-all', { api: fake.url, json: false, csv, all: true });
    await fake.close();

    const rows = readFileSync(csv, 'utf8').trim().split('\n');
    expect(rows.length).toBe(3); // header + both codes
  });

  it('deduplicates a shared code delivered three times into one CSV row, one PNG and one PDF page', async () => {
    const fake = await startCodesFake({
      id: 'camp-shared', name: 'Shared', codeMode: 'shared', codePrefix: 'SHR001',
      pages: [[
        { code: 'SHR001_0000000001', status: 'claimed' },
        { code: 'SHR001_0000000001', status: 'claimed' },
        { code: 'SHR001_0000000001', status: 'claimed' },
      ]],
    });

    const csv = join(dir, 'shared.csv');
    const qrDir = join(dir, 'shared-qr');
    const pdf = join(dir, 'shared.pdf');
    await campaignCodes('camp-shared', { api: fake.url, json: false, csv, qrDir, pdf });
    await fake.close();

    const rows = readFileSync(csv, 'utf8').trim().split('\n');
    expect(rows.length).toBe(2); // header + one row, exported even though every row is claimed

    const pngFiles = readdirSync(qrDir);
    expect(pngFiles).toEqual(['SHR001_0000000001.png']);

    const pdfDoc = await PDFDocument.load(readFileSync(pdf));
    expect(pdfDoc.getPageCount()).toBe(1);
  });

  it('keeps both claim_uri and fallback_url columns in the CSV regardless of --fallback', async () => {
    const fake = await startCodesFake({
      id: 'camp-fb', name: 'Fallback', codeMode: 'unique', codePrefix: 'FBK001',
      pages: [[{ code: 'FBK001_0000000001', status: 'unclaimed' }]],
    });

    const csv = join(dir, 'fb.csv');
    await campaignCodes('camp-fb', { api: fake.url, json: false, csv, fallback: true });
    await fake.close();

    const text = readFileSync(csv, 'utf8');
    expect(text).toContain('web+cardano://claim/v1?faucet_url=');
    expect(text).toContain(`${fake.url}/api/qr/`);
  });

  it('prints a table without any output flag, and json with both uri fields', async () => {
    const fake = await startCodesFake({
      id: 'camp-table', name: 'Table', codeMode: 'unique', codePrefix: 'TBL001',
      pages: [[{ code: 'TBL001_0000000001', status: 'unclaimed' }]],
    });

    await campaignCodes('camp-table', { api: fake.url, json: false });
    expect(output.join('')).toContain('TBL001_0000000001');

    output = [];
    await campaignCodes('camp-table', { api: fake.url, json: true });
    const parsed = JSON.parse(output.join(''));
    expect(parsed.campaign.id).toBe('camp-table');
    expect(parsed.codes[0].claim_uri).toContain('web+cardano://');
    expect(parsed.codes[0].fallback_url).toContain('/api/qr/');
    await fake.close();
  });

  it('prints one line per written target with counts, json prints paths and count', async () => {
    const fake = await startCodesFake({
      id: 'camp-out', name: 'Out', codeMode: 'unique', codePrefix: 'OUT001',
      pages: [[{ code: 'OUT001_0000000001', status: 'unclaimed' }, { code: 'OUT001_0000000002', status: 'unclaimed' }]],
    });

    const csv = join(dir, 'out.csv');
    const qrDir = join(dir, 'out-qr');
    await campaignCodes('camp-out', { api: fake.url, json: false, csv, qrDir });
    const text = output.join('');
    expect(text).toContain(csv);
    expect(text).toContain(qrDir);

    output = [];
    await campaignCodes('camp-out', { api: fake.url, json: true, csv, qrDir });
    const parsed = JSON.parse(output.join(''));
    expect(parsed.csv).toBe(csv);
    expect(parsed.qrDir).toBe(qrDir);
    expect(parsed.count).toBe(2);
    expect(parsed.pdf).toBeUndefined();
    await fake.close();
  });

  it('throws Not logged in without a stored token', async () => {
    delete process.env.CLAIMPAIGN_TOKEN;
    await expect(campaignCodes('camp-x', { api: 'http://127.0.0.1:1', json: false })).rejects.toThrow('Not logged in');
  });
});
