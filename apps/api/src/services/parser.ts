import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export interface ParseResult {
  text: string;
  pageCount?: number;
}

export async function parseFile(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<ParseResult> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    const data = await pdfParse(buffer);
    return { text: data.text, pageCount: data.numpages };
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value };
  }

  if (['text/plain', 'text/markdown'].includes(mimeType) || ['txt', 'md'].includes(ext)) {
    return { text: buffer.toString('utf-8') };
  }

  if (mimeType === 'application/json' || ext === 'json') {
    const obj = JSON.parse(buffer.toString('utf-8'));
    return { text: JSON.stringify(obj, null, 2) };
  }

  if (mimeType === 'text/csv' || ext === 'csv') {
    return { text: buffer.toString('utf-8') };
  }

  throw new Error(`Unsupported file type: ${mimeType} (${filename})`);
}

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const ALLOWED_EXTENSIONS = new Set(['pdf', 'txt', 'md', 'docx', 'csv', 'json']);
