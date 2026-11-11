'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * Renders assistant answers as designed layout instead of raw model text.
 *
 * The model is asked for plain prose and short "Label: value" lines, but it
 * still occasionally emits markdown. This parses either form: asterisks become
 * real emphasis rather than literal stars, pipe tables become real tables, and
 * key figures are pulled out as prominent values. Nothing here renders
 * untrusted HTML.
 */

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'metrics'; items: Array<{ label: string; value: string }> }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'ordered'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'statement'; title: string; rows: Array<{ label: string; value: string }>; total?: { label: string; value: string } }
  | { kind: 'para'; text: string };

const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*•·]\s+(.*)$/;
const ORDERED = /^\s*(\d{1,2})[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_RULE = /^\s*\|?[\s:-]*\|[\s:|-]*\|?\s*$/;
const METRIC = /^([A-Za-z][A-Za-z0-9 /&'’()\-]{1,38}?)\s*:\s*(.{1,48})$/;

function stripBold(value: string) {
  return value.replace(/\*\*/g, '').replace(/__/g, '').trim();
}

/** Render **bold**, `code` and *italic* inline, without regex lookbehind. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|__[^_\n]+__)/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(<Fragment key={`${keyPrefix}-t${index++}`}>{text.slice(last, match.index)}</Fragment>);
    const token = match[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={`${keyPrefix}-b${index++}`} className="font-semibold text-navy">{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={`${keyPrefix}-c${index++}`} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.92em] text-navy">{token.slice(1, -1)}</code>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(<Fragment key={`${keyPrefix}-t${index++}`}>{text.slice(last)}</Fragment>);
  // Any leftover lone asterisks would look like markdown noise; drop them.
  return nodes.map((node) => (typeof node === 'string' ? node.replace(/(^|\s)\*+(\s|$)/g, '$1$2') : node));
}

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((cell) => stripBold(cell).replace(/\*\*/g, '').trim());
}

function isMetricLine(line: string): { label: string; value: string } | null {
  const match = line.match(METRIC);
  if (!match) return null;
  const label = stripBold(match[1]).replace(/[.:]$/, '').trim();
  const value = stripBold(match[2]).trim();
  if (!label || !value) return null;
  if (/^https?$/i.test(value)) return null;
  // Sentence-like labels belong in prose, not the stat strip.
  if (/[.!?]$/.test(label) || label.split(' ').length > 6) return null;
  return { label, value };
}

function parse(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    const paragraph = buffer.join(' ').trim();
    if (paragraph) blocks.push({ kind: 'para', text: paragraph });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flushBuffer(); continue; }

    const heading = line.match(HEADING);
    if (heading) {
      flushBuffer();
      blocks.push({ kind: 'heading', text: stripBold(heading[2]) });
      continue;
    }

    if (TABLE_ROW.test(line)) {
      flushBuffer();
      const rows: string[][] = [];
      let cursor = i;
      while (cursor < lines.length && TABLE_ROW.test(lines[cursor])) {
        if (!TABLE_RULE.test(lines[cursor])) rows.push(splitRow(lines[cursor]));
        cursor += 1;
      }
      if (rows.length) blocks.push({ kind: 'table', head: rows[0], rows: rows.slice(1) });
      i = cursor - 1;
      continue;
    }

    if (BULLET.test(line)) {
      flushBuffer();
      const items: string[] = [];
      let cursor = i;
      while (cursor < lines.length && BULLET.test(lines[cursor])) {
        const item = lines[cursor].match(BULLET);
        if (item) items.push(item[1].trim());
        cursor += 1;
      }
      blocks.push({ kind: 'bullets', items });
      i = cursor - 1;
      continue;
    }

    if (ORDERED.test(line)) {
      flushBuffer();
      const items: string[] = [];
      let cursor = i;
      while (cursor < lines.length && ORDERED.test(lines[cursor])) {
        const item = lines[cursor].match(ORDERED);
        if (item) items.push(item[2].trim());
        cursor += 1;
      }
      blocks.push({ kind: 'ordered', items });
      i = cursor - 1;
      continue;
    }

    // A short line that ends in a colon is a section label ("Assets:"),
    // which reads far better as a heading than as a paragraph.
    const sectionLabel = line.match(/^\s*([A-Za-z][A-Za-z0-9 &/'’()-]{1,40}):\s*$/);
    if (sectionLabel) {
      flushBuffer();
      blocks.push({ kind: 'heading', text: sectionLabel[1].trim() });
      i += 0;
      continue;
    }

    const metric = isMetricLine(line);
    if (metric) {
      flushBuffer();
      const items = [metric];
      let cursor = i + 1;
      while (cursor < lines.length) {
        const next = lines[cursor];
        if (!next.trim()) break;
        const candidate = isMetricLine(next);
        if (!candidate) break;
        items.push(candidate);
        cursor += 1;
      }
      // A single short line is more likely a sentence than a statistic.
      if (items.length >= 2 || /\d/.test(metric.value)) blocks.push({ kind: 'metrics', items });
      else buffer.push(line);
      i = cursor - 1;
      continue;
    }

    buffer.push(stripBold(line));
  }
  flushBuffer();
  return buildStatements(blocks);
}

const MONEY_VALUE = /^(?:[A-Z]{3}\s*)?-?\(?[\d,]+(?:\.\d{1,2})?\)?$/;

/** "- Cash and bank: KES 1,820,000.00" -> a labelled amount. */
function asStatementRow(item: string): { label: string; value: string } | null {
  const match = item.match(/^(.{2,70}?)\s*:\s*((?:[A-Z]{3}\s*)?-?\(?[\d,]+(?:\.\d{1,2})?\)?)$/);
  if (!match) return null;
  const label = stripBold(match[1]).trim();
  const value = stripBold(match[2]).trim();
  if (!label || !MONEY_VALUE.test(value)) return null;
  return { label, value };
}

/** "Total assets: KES 3,270,000.00" -> the closing line of a statement. */
function asTotalLine(text: string): { label: string; value: string } | null {
  const match = text.match(/^\s*(Total[^:]{0,48}|Net [^:]{0,40}|Balance check|Closing balance|Opening balance)\s*:\s*((?:[A-Z]{3}\s*)?-?\(?[\d,]+(?:\.\d{1,2})?\)?)\s*$/i);
  if (!match) return null;
  return { label: match[1].trim(), value: match[2].trim() };
}

/**
 * Financial statements arrive as a heading, a run of "label: amount" lines and
 * a closing total. Rendering them as a statement (label left, amount right,
 * rule above the total) reads far better than a stack of tiles.
 */
function buildStatements(blocks: Block[]): Block[] {
  const output: Block[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const next = blocks[i + 1];
    if (block.kind === 'heading' && next && next.kind === 'bullets') {
      const rows = next.items.map(asStatementRow);
      const numeric = rows.filter(Boolean).length;
      if (numeric >= Math.max(2, Math.ceil(next.items.length * 0.6))) {
        let total: { label: string; value: string } | undefined;
        const after = blocks[i + 2];
        if (after) {
          const candidate = after.kind === 'para' ? asTotalLine(after.text) : after.kind === 'metrics' && after.items.length === 1 ? asTotalLine(`${after.items[0].label}: ${after.items[0].value}`) : null;
          if (candidate) { total = candidate; i += 1; }
        }
        output.push({ kind: 'statement', title: block.text, rows: rows.filter((row): row is { label: string; value: string } => row !== null), total });
        i += 1;
        continue;
      }
    }
    output.push(block);
  }
  return output;
}

function toneFor(label: string, value: string): string {
  const numeric = Number((value.match(/-?\d[\d,.]*/) ?? [''])[0].replace(/,/g, ''));
  const risky = /late|overdue|missing|absent|pending|risk|fail|error|reject/i.test(label);
  const positive = /present|approved|complete|posted|balanced|on time/i.test(label);
  if (risky && Number.isFinite(numeric) && numeric > 0) return 'text-amber-600';
  if (positive && Number.isFinite(numeric) && numeric > 0) return 'text-teal-700';
  if (Number.isFinite(numeric) && numeric === 0) return 'text-slate-400';
  return 'text-navy';
}

function MetricValue({ value, label }: { value: string; label: string }) {
  const match = value.match(/^([^\d]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!match) return <span className={`text-sm font-semibold ${toneFor(label, value)}`}>{value}</span>;
  const [, prefix, number, suffix] = match;
  return (
    <span className={`tabular font-semibold ${toneFor(label, value)}`}>
      {prefix.trim() ? <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{prefix.trim()}</span> : null}
      <span className="text-xl leading-none tracking-[-0.03em]">{number}</span>
      {suffix.trim() ? <span className="ml-1 text-[11px] font-medium text-slate-500">{suffix.trim()}</span> : null}
    </span>
  );
}

export default function AiAnswer({ text, compact = false }: { text: string; compact?: boolean }) {
  const blocks = parse(text ?? '');
  if (!blocks.length) return null;
  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-3.5'}>
      {blocks.map((block, index) => {
        const key = `blk-${index}`;
        if (block.kind === 'heading') {
          return (
            <div key={key} className="flex items-center gap-2 pt-0.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
              <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-navy">{inline(block.text, key)}</h4>
            </div>
          );
        }
        if (block.kind === 'metrics') {
          return (
            <div key={key} className="grid gap-2 sm:grid-cols-2">
              {block.items.map((item, i) => (
                <div key={`${key}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-line/70 bg-white px-3 py-2">
                  <span className="min-w-0 truncate text-[11px] font-medium text-slate-500">{inline(item.label, `${key}-l${i}`)}</span>
                  <MetricValue value={item.value} label={item.label} />
                </div>
              ))}
            </div>
          );
        }
        if (block.kind === 'bullets') {
          return (
            <ul key={key} className="space-y-1.5">
              {block.items.map((item, i) => (
                <li key={`${key}-${i}`} className="flex gap-2.5 text-[13px] leading-6 text-slate-700">
                  <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rotate-45 bg-gold/80" />
                  <span className="min-w-0">{inline(item, `${key}-${i}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'ordered') {
          return (
            <ol key={key} className="space-y-1.5">
              {block.items.map((item, i) => (
                <li key={`${key}-${i}`} className="flex gap-2.5 text-[13px] leading-6 text-slate-700">
                  <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-navy text-[10px] font-bold text-white">{i + 1}</span>
                  <span className="min-w-0">{inline(item, `${key}-${i}`)}</span>
                </li>
              ))}
            </ol>
          );
        }
        if (block.kind === 'statement') {
          return (
            <div key={key} className="overflow-hidden rounded-lg border border-line">
              <div className="flex items-center gap-2 border-b border-line bg-canvas px-3 py-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy">{block.title}</span>
              </div>
              <div className="divide-y divide-line/60">
                {block.rows.map((row, r) => (
                  <div key={`${key}-r${r}`} className="flex items-baseline justify-between gap-4 bg-white px-3 py-[7px]">
                    <span className="min-w-0 text-[12px] leading-5 text-slate-600">{inline(row.label, `${key}-l${r}`)}</span>
                    <span className={`shrink-0 tabular text-[12px] font-semibold ${/^\(|^-/.test(row.value) ? 'text-red-700' : 'text-navy'}`}>{row.value}</span>
                  </div>
                ))}
              </div>
              {block.total && (
                <div className="flex items-baseline justify-between gap-4 border-t-2 border-navy/80 bg-canvas px-3 py-2.5">
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-navy">{block.total.label}</span>
                  <span className={`shrink-0 tabular text-[13px] font-bold ${/^\(|^-/.test(block.total.value) ? 'text-red-700' : 'text-navy'}`}>{block.total.value}</span>
                </div>
              )}
            </div>
          );
        }
        if (block.kind === 'table') {
          // A money column is right-aligned and tabular; a text column is not.
          const moneyColumn = block.head.map((head, i) => i > 0 && /(amount|debit|credit|balance|total|value|kes|usd)/i.test(head))
            .map((isMoney, i) => isMoney || block.rows.every((row) => !row[i] || /^[\s(—-]*(?:[A-Z]{3}\s*)?-?[\d,]+(?:\.\d{1,2})?\)?$/i.test(row[i])));
          return (
            <div key={key} className="overflow-hidden rounded-lg border border-line">
              <table className="w-full border-collapse text-left">
                <thead className="bg-canvas">
                  <tr>
                    {block.head.map((cell, i) => (
                      <th key={`${key}-h${i}`} className={`px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 ${moneyColumn[i] ? 'text-right' : ''}`}>{cell}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {block.rows.map((row, r) => (
                    <tr key={`${key}-r${r}`} className={`bg-white ${/^total|^net |^closing|^balance (c\/f|carried)/i.test(row[0] ?? '') ? 'bg-canvas/60 font-semibold' : ''}`}>
                      {row.map((cell, c) => (
                        <td key={`${key}-r${r}c${c}`} className={`px-3 py-2 text-[12px] text-slate-700 ${moneyColumn[c] ? 'text-right tabular font-semibold text-navy' : 'font-medium'}`}>{inline(cell, `${key}-${r}-${c}`)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={key} className="text-[13px] leading-6 text-slate-700">{inline(block.text, key)}</p>;
      })}
    </div>
  );
}
