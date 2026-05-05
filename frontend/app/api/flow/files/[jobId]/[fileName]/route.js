import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Readable } from 'stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESULT_DIR = path.join(process.cwd(), 'public', 'flow-results');


const MEDIA_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function isZipBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

function extractFirstMediaFromZipBuffer(zipBuffer) {
  let offset = 0;
  while (offset + 30 <= zipBuffer.length) {
    const signature = zipBuffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      const next = zipBuffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), offset + 1);
      if (next === -1) break;
      offset = next;
      continue;
    }

    const generalPurposeFlag = zipBuffer.readUInt16LE(offset + 6);
    const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
    const extraLength = zipBuffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (nameEnd > zipBuffer.length || dataStart > zipBuffer.length || dataEnd > zipBuffer.length) break;

    const rawName = zipBuffer.slice(nameStart, nameEnd).toString('utf8');
    const fileName = path.basename(rawName || 'result');
    const ext = path.extname(fileName).toLowerCase();
    if (!rawName.endsWith('/') && MEDIA_TYPES[ext]) {
      let data = zipBuffer.slice(dataStart, dataEnd);
      if (compressionMethod === 8) data = zlib.inflateRawSync(data);
      if (compressionMethod !== 0 && compressionMethod !== 8) throw new Error(`ZIP compression chưa hỗ trợ: ${compressionMethod}`);
      return { fileName, ext, data };
    }

    if ((generalPurposeFlag & 0x08) && compressedSize === 0) break;
    offset = dataEnd;
  }
  return null;
}

function resolveActualMediaFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.zip') return { filePath, fileName: path.basename(filePath) };

  const zipBuffer = fs.readFileSync(filePath);
  if (!isZipBuffer(zipBuffer)) return { filePath, fileName: path.basename(filePath) };

  const extracted = extractFirstMediaFromZipBuffer(zipBuffer);
  if (!extracted) return { filePath, fileName: path.basename(filePath) };

  const outputName = `${path.basename(filePath, '.zip')}-extracted${extracted.ext}`;
  const outputPath = path.join(path.dirname(filePath), outputName);
  if (!fs.existsSync(outputPath)) fs.writeFileSync(outputPath, extracted.data);
  return { filePath: outputPath, fileName: outputName };
}

function safeSegment(value) {
  return path.basename(String(value || ''));
}

function getContentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (MEDIA_TYPES[ext]) return MEDIA_TYPES[ext];
  if (ext === '.zip') return 'application/zip';
  return 'application/octet-stream';
}

function buildFilePath(jobId, fileName) {
  const safeJobId = safeSegment(jobId);
  const safeFileName = safeSegment(fileName);
  const filePath = path.join(RESULT_DIR, safeJobId, safeFileName);

  const normalizedRoot = path.resolve(RESULT_DIR);
  const normalizedFile = path.resolve(filePath);

  if (!normalizedFile.startsWith(normalizedRoot)) {
    throw new Error('Invalid file path');
  }

  return filePath;
}

async function serveFile(request, params, headOnly = false) {
  const { jobId, fileName } = await params;
  const filePath = buildFilePath(jobId, fileName);

  if (!fs.existsSync(filePath)) {
    return new Response('File not found', { status: 404 });
  }

  const actual = resolveActualMediaFile(filePath);
  const stat = fs.statSync(actual.filePath);
  const size = stat.size;
  const contentType = getContentType(actual.fileName);
  const range = request.headers.get('range');

  const baseHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Disposition': `inline; filename="${safeSegment(actual?.fileName || fileName)}"`,
  };

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      return new Response('Invalid range', { status: 416 });
    }

    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : size - 1;

    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= size) end = size - 1;

    if (start > end || start >= size) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes */${size}`,
        },
      });
    }

    const chunkSize = end - start + 1;
    return new Response(
      headOnly ? null : Readable.toWeb(fs.createReadStream(actual.filePath, { start, end })),
      {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${size}`,
        },
      }
    );
  }

  return new Response(
    headOnly ? null : Readable.toWeb(fs.createReadStream(actual.filePath)),
    {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': String(size),
      },
    }
  );
}

export async function GET(request, { params }) {
  try {
    return await serveFile(request, params, false);
  } catch (error) {
    return new Response(error?.message || 'Cannot serve file', { status: 400 });
  }
}

export async function HEAD(request, { params }) {
  try {
    return await serveFile(request, params, true);
  } catch {
    return new Response(null, { status: 400 });
  }
}
