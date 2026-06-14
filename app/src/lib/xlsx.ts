/**
 * Minimal, dependency-free `.xlsx` → CSV reader.
 *
 * An .xlsx file is a ZIP archive of XML parts. We read the first worksheet and
 * the shared-strings table, flatten the cells into a grid, and emit CSV text
 * that the existing `parseCsvRows` pipeline already understands. Decompression
 * uses the browser's built-in `DecompressionStream` ("deflate-raw"), so no
 * SheetJS/zip dependency is added. Only text/number cells are needed for this
 * importer (type, recipient, amount, memo, schedule), so style/date handling is
 * intentionally out of scope.
 */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function readZipDirectory(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // Find the End Of Central Directory record (signature 0x06054b50), scanning
  // back from the end (the trailing comment is almost always empty).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65_557; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("Not a valid .xlsx file (no ZIP directory).");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    entries.push({ name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // Copy into a concrete ArrayBuffer so the Blob part is typed cleanly
  // (a subarray's buffer is ArrayBufferLike, which the DOM lib rejects).
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  const stream = new Blob([ab]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntryText(buf: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const lo = entry.localHeaderOffset;
  const nameLen = view.getUint16(lo + 26, true);
  const extraLen = view.getUint16(lo + 28, true);
  const dataStart = lo + 30 + nameLen + extraLen;
  const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  const out = entry.method === 0 ? raw : await inflateRaw(raw);
  return new TextDecoder().decode(out);
}

function columnIndex(cellRef: string): number {
  const letters = cellRef.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Convert the first worksheet of an .xlsx file to CSV text. */
export async function xlsxToCsv(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const entries = readZipDirectory(buf);

  const sheetEntry = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (sheetEntry === undefined) throw new Error("No worksheet found in the .xlsx file.");

  // Shared strings (optional).
  const sharedEntry = entries.find((e) => e.name === "xl/sharedStrings.xml");
  const sharedStrings: string[] = [];
  if (sharedEntry !== undefined) {
    const doc = new DOMParser().parseFromString(await readEntryText(buf, sharedEntry), "application/xml");
    for (const si of Array.from(doc.getElementsByTagName("si"))) {
      const texts = Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "");
      sharedStrings.push(texts.join(""));
    }
  }

  const sheetDoc = new DOMParser().parseFromString(await readEntryText(buf, sheetEntry), "application/xml");
  const rows: string[][] = [];
  for (const rowEl of Array.from(sheetDoc.getElementsByTagName("row"))) {
    const cells: string[] = [];
    for (const c of Array.from(rowEl.getElementsByTagName("c"))) {
      const ref = c.getAttribute("r") ?? "A1";
      const type = c.getAttribute("t");
      let value: string;
      if (type === "s") {
        const idx = Number(c.getElementsByTagName("v")[0]?.textContent ?? "0");
        value = sharedStrings[idx] ?? "";
      } else if (type === "inlineStr") {
        value = c.getElementsByTagName("t")[0]?.textContent ?? "";
      } else {
        value = c.getElementsByTagName("v")[0]?.textContent ?? "";
      }
      const col = columnIndex(ref);
      while (cells.length <= col) cells.push("");
      cells[col] = value;
    }
    rows.push(cells);
  }

  return rows.map((cells) => cells.map(csvEscape).join(",")).join("\n");
}

/** True when a file looks like an Excel workbook by name or MIME type. */
export function isXlsx(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith(".xlsx") ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}
