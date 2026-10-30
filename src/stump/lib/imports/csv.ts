// RFC 4180 CSV: quoted cells, doubled quotes, line breaks inside quotes, CRLF or
// LF, an optional byte order mark. Blank lines are skipped.
import { ImportInputError } from './types.ts';

export interface CsvTable { header: string[]; rows: { line: number; cells: string[] }[] }

export function parseCsv(input: string, maxRows: number): CsvTable {
  const text = input.replace(/^﻿/, '');
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let cellStarted = false;
  let line = 1;
  let recordLine = 1;
  const endCell = () => { cells.push(cell); cell = ''; cellStarted = false; };
  const endRecord = () => {
    endCell();
    if (!(cells.length === 1 && cells[0] === '')) {
      if (records.length > maxRows) throw new ImportInputError('too_many_rows', `The CSV holds more than ${maxRows} rows.`);
      records.push({ line: recordLine, cells });
    }
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else { if (ch === '\n') line++; cell += ch; }
      continue;
    }
    if (ch === '"' && !cellStarted && cell === '') { quoted = true; cellStarted = true; }
    else if (ch === ',') endCell();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else { cell += ch; cellStarted = true; }
  }
  if (quoted) throw new ImportInputError('csv_unterminated_quote', `A quoted cell starting on line ${recordLine} is never closed.`);
  if (cell !== '' || cells.length) endRecord();
  const head = records.shift();
  if (!head) throw new ImportInputError('not_venue_list', 'The CSV is empty.');
  return { header: head.cells.map(h => h.trim()), rows: records };
}
