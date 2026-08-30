import { UserFacingError } from "../util/userError.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function readString(bytes) {
  return new TextDecoder().decode(bytes);
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([\da-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&amp;/g, "&");
}

function extractDocumentXml(xml) {
  const paragraphs = [];
  const paragraphPattern = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  let paragraph;
  while ((paragraph = paragraphPattern.exec(xml))) {
    const body = paragraph[1];
    const style = body.match(/<w:pStyle[^>]+w:val="([^"]+)"/i)?.[1] || "";
    let text = "";
    const tokenPattern =
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:tab|br)(?:\s[^>]*)?\/>/gi;
    let token;
    while ((token = tokenPattern.exec(body))) {
      text += decodeXml(
        token[1] ?? (token[0].toLowerCase().includes("<w:tab") ? "\t" : "\n"),
      );
    }
    if (!text.trim()) continue;
    const heading = /^Heading\d+$/i.test(style);
    paragraphs.push(`${heading ? "# " : ""}${text.trim()}`);
  }
  return paragraphs.join("\n\n").trim();
}

async function inflate(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new UserFacingError(
      "This browser cannot decompress DOCX files. Try exporting the document as PDF or plain text.",
    );
  }
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function centralDirectoryEntries(bytes, view) {
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) !== EOCD_SIGNATURE) continue;
    const count = view.getUint16(i + 10, true);
    const offset = view.getUint32(i + 16, true);
    const entries = [];
    let cursor = offset;
    for (let index = 0; index < count; index++) {
      if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
        throw new UserFacingError("This DOCX file is corrupt.");
      }
      const flags = view.getUint16(cursor + 8, true);
      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const name = readString(
        bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      );
      entries.push({
        name,
        flags,
        method,
        compressedSize,
        localOffset,
      });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }
  throw new UserFacingError("This file is not a valid DOCX archive.");
}

async function readEntry(bytes, view, entry) {
  if (entry.flags & 1) {
    throw new UserFacingError("This DOCX file is password-protected.");
  }
  const offset = entry.localOffset;
  if (view.getUint32(offset, true) !== LOCAL_SIGNATURE) {
    throw new UserFacingError("This DOCX file is corrupt.");
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length)
    throw new UserFacingError("This DOCX file is corrupt.");
  const compressed = bytes.subarray(start, end);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflate(compressed);
  throw new UserFacingError(
    "This DOCX uses an unsupported compression method.",
  );
}

export async function extractDocxText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entry = centralDirectoryEntries(bytes, view).find(
    ({ name }) => name === "word/document.xml",
  );
  if (!entry) throw new UserFacingError("This is not a valid Word DOCX file.");
  const xml = readString(await readEntry(bytes, view, entry));
  const text = extractDocumentXml(xml);
  if (!text)
    throw new UserFacingError("This DOCX file contains no readable text.");
  return text;
}
