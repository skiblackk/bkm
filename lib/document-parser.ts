/**
 * Turns an uploaded file into a grid of cells the accounting engine can reason
 * about. Everything here is pure computation on the file bytes: no network, no
 * shelling out to a binary that a serverless host may not provide.
 */

export type Grid = string[][];

export type ParseResult = {
  grid: Grid;
  text: string;
  sheets: string[];
  rowCount: number;
  warnings: string[];
};

const SEPARATORS = ['consume', 'tab', 'pipeline', 'semicolon'];

/** True when the file looks like a spreadsheet export rather than prose. */
function looksDelimited(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 40);
  if (lines.length < 2) return false;
  const counts = SEPARATORS.map((sep) => {
    const tally = lines.map((line) => line.split(sep === 'tab' ? '\t' : sep === 'pipeline' ? '|' : sep === 'semicolon' ? ';' : ',').length - 1);
    const min = Math.min(...tally);
    const nonZero = tally.filter((count) => count > 0).length;
    return { sep, min, nonZero };
  });
  // A real table has the same delimiter count on almost every row. Decimal
  // commas clear the bar on their own, so require a delimiter in most rows.
  const best = counts.filter((count) => count.nonZero >= lines.length * 0.7 && count.min >= 1).sort((a, b) => b.min - a.min)[0];
  return best ? (best.sep === 'tab' ? '\t' : best.sep === 'pipeline' ? '|' : best.sep === 'semicolon' ? ';' : ',') : null;
}

/** Split delimited text, respecting double quotes and thousands separators. */
export function splitDelimited(text: string, delimiter: string): Grid {
  const rows: Grid = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === delimiter) { row.push(cell); cell = ''; continue; }
    if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += char;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const width = Math.max(...rows.map((item) => item.length), 0);
  return rows
    .map((item) => { const copy = item.map((value) => value.trim()); while (copy.length < width) copy.push(''); return copy; })
    .filter((item) => item.some((value) => value !== ''));
}

/**
 * PDF text extraction collapses column padding, so a table arrives as
 * "Cash and bank 1,820,000.00" on one line. Rebuild columns by taking the
 * numbers off the right-hand end of each line, in order.
 */
export function splitTrailingNumbers(text: string): Grid | null {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\u00a0/g, ' ').trimEnd()).filter((line) => line.trim());
  if (lines.length < 3) return null;
  const NUMBER_AT_END = /(?:^|\s)((?:\(?-?[A-Z]{3}\s*)?\(?-?[\d,]+(?:\.\d{1,2})?\)?)\s*$/;
  const rows: Grid = [];
  let numericLines = 0;
  let maxNumeric = 0;
  for (const line of lines) {
    const numbers: string[] = [];
    let rest = line.trim();
    for (let guard = 0; guard < 6; guard += 1) {
      const match = rest.match(NUMBER_AT_END);
      if (!match) break;
      // Do not treat a year or an item count as a column value.
      const raw = match[1].trim();
      if (!/[\d]/.test(raw) || /^(19|20)\d{2}$/.test(raw.replace(/,/g, ''))) break;
      numbers.unshift(raw);
      rest = rest.slice(0, rest.length - match[1].length).trimEnd();
    }
    if (numbers.length) { numericLines += 1; maxNumeric = Math.max(maxNumeric, numbers.length); }
    rows.push(numbers.length ? [rest.trim(), ...numbers] : [rest.trim()]);
  }
  // Only accept this shape when most rows really do end in figures.
  if (numericLines < Math.max(3, rows.length * 0.4)) return null;

  // The header names the columns, and its order tells us which side of the
  // ledger a lone figure belongs to: a credit in a Debit/Credit table is not
  // an expense.
  const headerIndex = rows.findIndex((row) => /debit/i.test(row[0]) && /credit/i.test(row[0]));
  // "Account Debit Credit" arrives as one cell; split it so the engine can map
  // columns by name.
  if (headerIndex > -1 && rows[headerIndex].length === 1) {
    const words = rows[headerIndex][0].split(/\s+/);
    const known = /^(account|accounts|ledger|nominal|code|date|description|details|narration|particulars|debit|credit|dr|cr|amount|value|balance)$/i;
    if (words.filter((word) => known.test(word)).length >= 2) {
      const columns = words.filter((word) => known.test(word));
      rows[headerIndex] = columns;
      // Push every figure row onto the same number of columns as the header.
      for (let i = 0; i < rows.length; i += 1) {
        if (i === headerIndex) continue;
        const row = rows[i];
        if (row.length < 2) continue;
        const copy = row.slice();
        while (copy.length < columns.length) copy.push('');
        rows[i] = copy.slice(0, columns.length);
      }
    }
  }
  const headerText = headerIndex > -1 ? rows[headerIndex].join(' ').toLowerCase() : '';
  const columns = headerIndex > -1 ? rows[headerIndex].map((column) => column.toLowerCase()) : [];
  // After the header split, rows carry the debit and credit amounts in the same
  // order the header names them.
  const debitIndex = Math.max(0, columns.findIndex((column) => /^(debit|dr)$/.test(column)));
  const creditIndex = Math.max(0, columns.findIndex((column) => /^(credit|cr)$/.test(column)));
  const columnOrder = /opening balance|balance|amount/i.test(headerText) && !/debit/i.test(headerText) ? 'balance-first' : 'dr-cr';

  const padded: Grid = rows.map((row) => { const copy = row.slice(); while (copy.length < maxNumeric + 1) copy.push(''); return copy; });

  if (maxNumeric === 1 && /debit|credit/.test(headerText)) {
    const debitIndex = Math.max(0, columns.findIndex((column) => /debit|\bdr\b/.test(column)));
    const creditIndex = Math.max(0, columns.findIndex((column) => /credit|\bcr\b/.test(column)));
    return padded.map((row) => {
      const hasLabel = row[0] && row[0].trim();
      if (!hasLabel) return row;
      const figures = row.slice(1).filter((value) => value && value.trim());
      if (figures.length === 2) {
        // Both columns present: place them by header position.
        const target = new Array(Math.max(debitIndex, creditIndex) + 1).fill('');
        target[0] = row[0];
        target[debitIndex] = figures[0];
        target[creditIndex] = figures[1];
        return target;
      }
      if (figures.length !== 1) return row;
      const label = row[0].toLowerCase();
      // One figure: which side it belongs to is decided by the account, since
      // the extracted line loses the column position.
      const isCreditNature = /payable|creditor|capital|equity|retained|revenue|income|fees|sales|turnover|loan|borrow|vat (payable|output)|tax payable|provision|accrual|deferred/i.test(label);
      const target = new Array(Math.max(debitIndex, creditIndex) + 1).fill('');
      target[0] = row[0];
      target[isCreditNature ? creditIndex : debitIndex] = figures[0];
      return target;
    });
  }
  return padded.filter((row) => row.some((value) => value.trim()));
}

/** Heuristic: does this text read like a fixed-width column report? */
function looksFixedWidth(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 25).slice(0, 30);
  if (lines.length < 4) return false;
  const spaced = lines.filter((line) => /\S {2,}\S/.test(line)).length;
  return spaced >= lines.length * 0.7;
}

/**
 * Fixed-width reports (typical accounting exports) have no delimiter, only
 * runs of spaces. Split on two-or-more spaces, keeping text columns intact.
 */
export function splitFixedWidth(text: string): Grid {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const cells: string[] = [];
      let current = '';
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '\t') { cells.push(current.trim()); current = ''; continue; }
        if (char === ' ') {
          // Measure the run of spaces; keep it when it sits inside a number.
          let end = i;
          while (line[end] === ' ') end += 1;
          const before = line[i - 1] ?? '';
          const after = line[end] ?? '';
          if (end - i >= 2 && !(/\d/.test(before) && /\d/.test(after)) && !/[,.]/.test(after)) {
            cells.push(current.trim());
            current = '';
            i = end - 1;
            continue;
          }
        }
        current += char;
      }
      if (current.trim()) cells.push(current.trim());
      return cells;
    })
    .filter((row) => row.length > 1 && row.some((value) => value));
}

/** Pick the most plausible table shape for a block of text. */
function buildGrid(text: string): Grid {
  const delimiter = looksDelimited(text);
  if (delimiter) return splitDelimited(text, delimiter);
  // Lines that each end in figures are a column table whatever their spacing.
  const trailing = splitTrailingNumbers(text);
  if (trailing) return trailing;
  if (looksFixedWidth(text)) return splitFixedWidth(text);
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => [line.trim()]);
}

export async function parseSpreadsheet(bytes: Buffer): Promise<ParseResult> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true, cellNF: false, cellStyles: false });
  const sheets = workbook.SheetNames;
  const grid: Grid = [];
  const chunks: string[] = [];
  let rowCount = 0;
  for (const sheetName of sheets) {
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], { header: 1, blankrows: false, raw: false, defval: '' }) as string[][];
    rowCount += rows.length;
    chunks.push(`WORKSHEET: ${sheetName}`, rows.map((row) => row.join('\t')).join('\n'));
    if (grid.length && rows.length) grid.push([]);
    for (const row of rows) grid.push(row.map((cell) => String(cell ?? '').trim()));
  }
  return { grid, text: chunks.join('\n'), sheets, rowCount, warnings: [] };
}

export async function parsePdf(bytes: Buffer): Promise<ParseResult> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const flat = String(text ?? '').replace(/\u00a0/g, ' ');
  const warnings: string[] = [];
  if (!flat.trim()) {
    warnings.push('This PDF has no embedded text layer, so it is probably a scan or an image. Nothing was read from it. Upload the Excel/CSV export or a text-based PDF.');
  } else if (flat.trim().length < 40 && totalPages > 1) {
    warnings.push(`Only ${flat.trim().length} characters were recovered from ${totalPages} pages, so most of this PDF is likely an image.`);
  }
  const grid = buildGrid(flat);
  return { grid, text: flat, sheets: [], rowCount: grid.length, warnings };
}

export function parsePlainText(text: string): ParseResult {
  const grid = buildGrid(text);
  return { grid, text, sheets: [], rowCount: grid.length, warnings: [] };
}

export async function parseDocument(filename: string, mimeType: string, bytes: Buffer): Promise<ParseResult & { kind: string }> {
  const extension = (filename.toLowerCase().split('.').pop() ?? '').trim();
  if (extension === 'pdf' || mimeType === 'application/pdf') return { ...(await parsePdf(bytes)), kind: 'pdf' };
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(extension) || /spreadsheet|excel|csv/.test(mimeType)) {
    if (extension === 'csv' && !/spreadsheet|excel/.test(mimeType)) {
      const text = bytes.toString('utf8');
      return { ...parsePlainText(text), kind: 'csv' };
    }
    return { ...(await parseSpreadsheet(bytes)), kind: 'spreadsheet' };
  }
  if (['txt', 'md', 'tsv', 'dat'].includes(extension) || mimeType.startsWith('text/')) {
    return { ...parsePlainText(bytes.toString('utf8')), kind: 'text' };
  }
  throw new Error('Upload a PDF, CSV, TXT or Excel workbook (.xlsx / .xls).');
}
