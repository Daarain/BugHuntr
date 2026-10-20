export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
]);

export const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".pdf",
  ".txt",
  ".log",
]);

export function sanitizeFolderName(folderInput?: string | null): string {
  if (!folderInput || typeof folderInput !== "string") {
    return "community-uploads";
  }
  const sanitized = folderInput
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "community-uploads";
}

export function validateUploadFile(
  fileName: string,
  mimeType: string,
  buffer: Buffer
): { valid: boolean; error?: string } {
  if (!fileName || typeof fileName !== "string") {
    return { valid: false, error: "File name is required." };
  }

  // Check file extension
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1) {
    return { valid: false, error: "File must have a valid extension." };
  }
  const ext = fileName.slice(lastDot).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File extension '${ext}' is not permitted.` };
  }

  // Check MIME type allowlist
  const normalizedMime = (mimeType || "").toLowerCase().trim();
  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
    return { valid: false, error: `MIME type '${normalizedMime}' is not permitted.` };
  }

  // Check file size
  if (buffer.length === 0) {
    return { valid: false, error: "File is empty." };
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return { valid: false, error: "File exceeds max size of 10MB." };
  }

  // Magic bytes verification
  if (normalizedMime === "image/png") {
    // 89 50 4E 47 0D 0A 1A 0A
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngHeader)) {
      return { valid: false, error: "Spoofed MIME type: buffer does not match PNG signature." };
    }
  } else if (normalizedMime === "image/jpeg") {
    // FF D8 FF
    if (
      buffer.length < 3 ||
      buffer[0] !== 0xff ||
      buffer[1] !== 0xd8 ||
      buffer[2] !== 0xff
    ) {
      return { valid: false, error: "Spoofed MIME type: buffer does not match JPEG signature." };
    }
  } else if (normalizedMime === "image/gif") {
    // GIF87a or GIF89a ("GIF8")
    const gifHeader = Buffer.from("GIF8");
    if (buffer.length < 4 || !buffer.subarray(0, 4).equals(gifHeader)) {
      return { valid: false, error: "Spoofed MIME type: buffer does not match GIF signature." };
    }
  } else if (normalizedMime === "image/webp") {
    // RIFF....WEBP
    if (
      buffer.length < 12 ||
      buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
      buffer.subarray(8, 12).toString("ascii") !== "WEBP"
    ) {
      return { valid: false, error: "Spoofed MIME type: buffer does not match WEBP signature." };
    }
  } else if (normalizedMime === "application/pdf") {
    // %PDF-
    const pdfHeader = Buffer.from("%PDF");
    if (buffer.length < 4 || !buffer.subarray(0, 4).equals(pdfHeader)) {
      return { valid: false, error: "Spoofed MIME type: buffer does not match PDF signature." };
    }
  } else if (normalizedMime === "text/plain") {
    // Check for null bytes in initial 1024 bytes (binary indicator)
    const probeLength = Math.min(buffer.length, 1024);
    for (let i = 0; i < probeLength; i++) {
      if (buffer[i] === 0x00) {
        return { valid: false, error: "Text file contains null bytes (binary content detected)." };
      }
    }
  }

  return { valid: true };
}
