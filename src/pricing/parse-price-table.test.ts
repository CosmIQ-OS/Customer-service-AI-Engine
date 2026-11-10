import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import writeXlsxFile from 'write-excel-file/node';
import { parsePriceTable } from './parse-price-table.js';

const HEADER = ['item_code', 'description', 'unit', 'unit_price'];

function csv(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'utf8');
}

async function xlsx(rows: Array<Array<string | number>>): Promise<Buffer> {
  return writeXlsxFile(rows as never).toBuffer();
}

describe('parsePriceTable', () => {
  it('parses a CSV price table and converts prices to paise', async () => {
    const result = await parsePriceTable('services.csv', csv([
      'item_code,description,unit,unit_price',
      'AUTO-01,Process mapping,hour,"1,250.50"',
      'AUTO-02,Bot setup,project,₹15000',
      'AUTO-03,Support retainer,month,499',
    ]));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.items.map((item) => item.unit_price_paise), [125050, 1500000, 49900]);
    assert.equal(result.items[0].item_code, 'AUTO-01');
    assert.equal(result.items[0].unit, 'hour');
  });

  it('accepts a UTF-8 BOM and headers written with spaces or capitals', async () => {
    const data = Buffer.concat([Buffer.from('\uFEFF', 'utf8'), csv([
      'Item Code,Description,Unit,Unit Price',
      'WF-1,Workflow build,project,25000',
    ])]);
    const result = await parsePriceTable('prices.csv', data);
    assert.equal(result.ok, true);
  });

  it('reads the first sheet of an XLSX file, including numeric prices', async () => {
    const data = await xlsx([
      HEADER,
      ['WA-1', 'WhatsApp agent setup', 'project', 12000],
      ['WA-2', 'Per-message handling', 'message', 0.25],
    ]);
    const result = await parsePriceTable('whatsapp.xlsx', data);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.items.map((item) => item.unit_price_paise), [1200000, 25]);
  });

  it('reports a missing required column on the header row', async () => {
    const result = await parsePriceTable('prices.csv', csv([
      'item_code,description,unit',
      'A,Thing,each',
    ]));
    assert.deepEqual(result, { ok: false, errors: [{ row: 1, message: 'Missing required column(s): unit_price' }] });
  });

  it('reports every invalid row with its row number and rejects the whole file', async () => {
    const result = await parsePriceTable('prices.csv', csv([
      'item_code,description,unit,unit_price',
      'A1,Good row,each,100',
      'A2,Bad price,each,abc',
      'A3,Negative,each,-5',
      'A4,Too precise,each,1.234',
      ',Missing code,each,10',
    ]));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.errors.map((error) => error.row), [3, 4, 5, 6]);
    assert.match(result.errors[0].message, /unit_price/);
    assert.match(result.errors[3].message, /item_code is required/);
  });

  it('rejects duplicate item codes regardless of case', async () => {
    const result = await parsePriceTable('prices.csv', csv([
      'item_code,description,unit,unit_price',
      'SKU-9,First,each,10',
      'sku-9,Second,each,20',
    ]));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errors[0].row, 3);
    assert.match(result.errors[0].message, /also on row 2/);
  });

  it('skips blank rows between data rows', async () => {
    const result = await parsePriceTable('prices.csv', csv([
      'item_code,description,unit,unit_price',
      'A1,First,each,10',
      '',
      'A2,Second,each,20',
    ]));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.items.length, 2);
  });

  it('rejects an empty file and a file with no data rows', async () => {
    const empty = await parsePriceTable('prices.csv', Buffer.alloc(0));
    assert.deepEqual(empty, { ok: false, errors: [{ row: 0, message: 'The file is empty.' }] });

    const headerOnly = await parsePriceTable('prices.csv', csv(['item_code,description,unit,unit_price']));
    assert.deepEqual(headerOnly, { ok: false, errors: [{ row: 0, message: 'No price rows found below the header.' }] });
  });

  it('rejects unsupported file types and corrupt workbooks', async () => {
    const pdf = await parsePriceTable('prices.pdf', Buffer.from('%PDF-1.4'));
    assert.match(pdf.ok ? '' : pdf.errors[0].message, /Unsupported file type/);

    const corrupt = await parsePriceTable('prices.xlsx', Buffer.from('not a real workbook'));
    assert.match(corrupt.ok ? '' : corrupt.errors[0].message, /Could not read the file/);
  });
});
