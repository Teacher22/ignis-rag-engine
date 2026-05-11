import { get_encoding } from 'tiktoken';

const enc = get_encoding('cl100k_base');

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;
const SEPARATORS = ['\n\n', '\n', '. ', ' ', ''];

export interface Chunk {
  text: string;
  index: number;
  tokenCount: number;
  page: number | null;
}

function countTokens(text: string): number {
  return enc.encode(text).length;
}

function splitOnSeparator(text: string, separator: string): string[] {
  if (!separator) return text.split('');
  return text.split(separator).filter((s) => s.trim().length > 0);
}

function recursiveSplit(
  text: string,
  separators: string[],
  chunkSize: number
): string[] {
  if (countTokens(text) <= chunkSize) return [text];

  const [sep, ...rest] = separators;
  if (sep === undefined) return [text]; // no more separators, return as-is

  const parts = splitOnSeparator(text, sep);
  const chunks: string[] = [];
  let current = '';

  for (const part of parts) {
    const candidate = current ? `${current}${sep}${part}` : part;
    if (countTokens(candidate) <= chunkSize) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      if (countTokens(part) > chunkSize) {
        chunks.push(...recursiveSplit(part, rest, chunkSize));
        current = '';
      } else {
        current = part;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function chunkText(text: string): Chunk[] {
  const rawChunks = recursiveSplit(text, SEPARATORS, CHUNK_SIZE);
  const result: Chunk[] = [];

  for (let i = 0; i < rawChunks.length; i++) {
    let chunkText = rawChunks[i];

    // Add overlap from previous chunk
    if (i > 0 && CHUNK_OVERLAP > 0) {
      const prev = rawChunks[i - 1];
      const prevWords = prev.split(' ');
      const overlapWords: string[] = [];
      let overlapTokens = 0;

      for (let j = prevWords.length - 1; j >= 0; j--) {
        const t = countTokens(prevWords[j]);
        if (overlapTokens + t > CHUNK_OVERLAP) break;
        overlapWords.unshift(prevWords[j]);
        overlapTokens += t;
      }

      if (overlapWords.length) {
        chunkText = `${overlapWords.join(' ')} ${chunkText}`;
      }
    }

    result.push({
      text: chunkText.trim(),
      index: i,
      tokenCount: countTokens(chunkText),
      page: null,
    });
  }

  return result.filter((c) => c.text.length > 0);
}

export function chunkRows(rows: Record<string, unknown>[], headers: string[]): Chunk[] {
  return rows.map((row, i) => {
    const headerLine = headers.join(',');
    const rowLine = headers.map((h) => String(row[h] ?? '')).join(',');
    const text = `${headerLine}\n${rowLine}`;
    return { text, index: i, tokenCount: countTokens(text), page: null };
  });
}
