const encoder = new TextEncoder();

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw fail("invalid_jpeg");
}

function u16(buf, offset) {
  return (buf[offset] << 8) | buf[offset + 1];
}

function u16endian(buf, offset, little) {
  if (little) return buf[offset] | (buf[offset + 1] << 8);
  return (buf[offset] << 8) | buf[offset + 1];
}

function u32endian(buf, offset, little) {
  if (little) {
    return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
  }
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
}

function pageRotate(orientation) {
  if (orientation === 1) return 0;
  if (orientation === 3) return 180;
  if (orientation === 6) return 90;
  if (orientation === 8) return 270;
  throw fail("invalid_jpeg");
}

function exifRotate(data) {
  if (data.length < 14) return 0;
  if (data[0] !== 0x45 || data[1] !== 0x78 || data[2] !== 0x69 || data[3] !== 0x66 || data[4] !== 0 || data[5] !== 0) {
    return 0;
  }
  const tiff = 6;
  const little = data[tiff] === 0x49 && data[tiff + 1] === 0x49;
  const big = data[tiff] === 0x4d && data[tiff + 1] === 0x4d;
  if (!little && !big) return 0;
  if (u16endian(data, tiff + 2, little) !== 42) return 0;
  const start = tiff + u32endian(data, tiff + 4, little);
  if (start + 2 > data.length) return 0;
  const count = u16endian(data, start, little);
  for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
    const entry = start + 2 + entryIndex * 12;
    if (entry + 12 > data.length) return 0;
    if (u16endian(data, entry, little) !== 0x0112) continue;
    if (u16endian(data, entry + 2, little) !== 3 || u32endian(data, entry + 4, little) !== 1) return 0;
    return pageRotate(u16endian(data, entry + 8, little));
  }
  return 0;
}

function jpegInfo(value) {
  const buf = asBytes(value);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw fail("invalid_jpeg");
  let index = 2;
  let rotate = 0;
  while (index + 3 < buf.length) {
    if (buf[index] !== 0xff) throw fail("invalid_jpeg");
    while (index + 1 < buf.length && buf[index] === 0xff && buf[index + 1] === 0xff) index += 1;
    if (index + 1 >= buf.length) throw fail("invalid_jpeg");
    const marker = buf[index + 1];
    if (marker === 0xd8) {
      index += 2;
      continue;
    }
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      index += 2;
      continue;
    }
    const length = u16(buf, index + 2);
    if (length < 2 || index + 2 + length > buf.length) throw fail("invalid_jpeg");
    if (marker === 0xe1) {
      const found = exifRotate(buf.subarray(index + 4, index + 2 + length));
      if (found) rotate = found;
    }
    if (marker >= 0xc0 && marker <= 0xc2 && marker !== 0xc1) {
      if (length < 8) throw fail("invalid_jpeg");
      const components = buf[index + 9];
      const height = u16(buf, index + 5);
      const width = u16(buf, index + 7);
      if ((components !== 1 && components !== 3) || !width || !height) throw fail("invalid_jpeg");
      return { height, width, components, rotate, bytes: buf };
    }
    index += 2 + length;
  }
  throw fail("invalid_jpeg");
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function pdfFromJpegs(photos) {
  const images = (photos ?? []).map((photo) => jpegInfo(photo?.bytes ?? photo));
  if (!images.length) throw fail("empty_pdf");
  const chunks = [];
  let length = 0;
  const offsets = [0];
  const push = (part) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const startObject = () => {
    offsets.push(length);
  };

  const kids = images.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  push("%PDF-1.4\n");
  startObject();
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  startObject();
  push(`2 0 obj\n<< /Type /Pages /Count ${images.length} /Kids [${kids}] >>\nendobj\n`);

  images.forEach((image, index) => {
    const pageId = 3 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const color = image.components === 1 ? "DeviceGray" : "DeviceRGB";
    const rotate = image.rotate ? ` /Rotate ${image.rotate}` : "";
    const content = `q\n${image.width} 0 0 ${image.height} 0 0 cm\n/Im0 Do\nQ\n`;
    startObject();
    push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R${rotate} /MediaBox [0 0 ${image.width} ${image.height}] /Contents ${contentId} 0 R /Resources << /XObject << /Im0 ${imageId} 0 R >> >> >>\nendobj\n`,
    );
    startObject();
    push(`${contentId} 0 obj\n<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
    startObject();
    push(
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${color} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
    );
    push(image.bytes);
    push("\nendstream\nendobj\n");
  });

  const xref = length;
  const size = offsets.length;
  let xrefBody = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    xrefBody += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  push(xrefBody);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return concat(chunks);
}
