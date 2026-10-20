import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  validateUploadFile,
  sanitizeFolderName,
  MAX_UPLOAD_BYTES,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
} from "../lib/upload-validation.ts";

test("Upload Validation: rejects disallowed extensions", () => {
  const disallowed = ["exploit.exe", "script.sh", "payload.php", "page.html", "vector.svg", "batch.bat"];
  const dummyBuffer = Buffer.from("console.log('test')");

  for (const file of disallowed) {
    const result = validateUploadFile(file, "text/plain", dummyBuffer);
    assert.equal(result.valid, false, `Expected ${file} to be rejected`);
    assert.match(result.error, /is not permitted/);
  }
});

test("Upload Validation: rejects disallowed or spoofed MIME types", () => {
  const dummyBuffer = Buffer.from("dummy data");
  const result = validateUploadFile("document.pdf", "application/x-executable", dummyBuffer);
  assert.equal(result.valid, false);
  assert.match(result.error, /MIME type 'application\/x-executable' is not permitted/);
});

test("Upload Validation: rejects spoofed PNG with invalid magic bytes", () => {
  // A file named test.png with MIME image/png, but containing plain text instead of 89 50 4E 47...
  const spoofedBuffer = Buffer.from("<html><script>alert(1)</script></html>");
  const result = validateUploadFile("test.png", "image/png", spoofedBuffer);
  assert.equal(result.valid, false);
  assert.match(result.error, /Spoofed MIME type: buffer does not match PNG signature/);
});

test("Upload Validation: accepts valid PNG with authentic magic bytes", () => {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
  const result = validateUploadFile("valid.png", "image/png", pngHeader);
  assert.equal(result.valid, true);
});

test("Upload Validation: rejects spoofed JPEG with invalid magic bytes", () => {
  const spoofedBuffer = Buffer.from("GIF89a not really jpeg");
  const result = validateUploadFile("photo.jpg", "image/jpeg", spoofedBuffer);
  assert.equal(result.valid, false);
  assert.match(result.error, /Spoofed MIME type: buffer does not match JPEG signature/);
});

test("Upload Validation: accepts valid JPEG with authentic magic bytes", () => {
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const result = validateUploadFile("photo.jpg", "image/jpeg", jpegHeader);
  assert.equal(result.valid, true);
});

test("Upload Validation: rejects spoofed PDF with invalid magic bytes", () => {
  const spoofedBuffer = Buffer.from("MZ\\x90\\x00\\x03 executable bytes");
  const result = validateUploadFile("doc.pdf", "application/pdf", spoofedBuffer);
  assert.equal(result.valid, false);
  assert.match(result.error, /Spoofed MIME type: buffer does not match PDF signature/);
});

test("Upload Validation: accepts valid PDF with %PDF magic bytes", () => {
  const pdfBuffer = Buffer.from("%PDF-1.4 header contents");
  const result = validateUploadFile("doc.pdf", "application/pdf", pdfBuffer);
  assert.equal(result.valid, true);
});

test("Upload Validation: rejects text files containing null bytes", () => {
  const binaryAsText = Buffer.from("Some text \x00 with embedded null bytes");
  const result = validateUploadFile("log.txt", "text/plain", binaryAsText);
  assert.equal(result.valid, false);
  assert.match(result.error, /contains null bytes/);
});

test("Upload Validation: accepts clean text files", () => {
  const cleanText = Buffer.from("Vulnerability report details and reproduction steps.");
  const result = validateUploadFile("report.txt", "text/plain", cleanText);
  assert.equal(result.valid, true);
});

test("Upload Validation: rejects oversized buffer", () => {
  // Over 10MB
  const oversizedBuffer = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
  // Give it valid PNG header so size check fails rather than magic bytes
  oversizedBuffer[0] = 0x89;
  oversizedBuffer[1] = 0x50;
  oversizedBuffer[2] = 0x4e;
  oversizedBuffer[3] = 0x47;
  oversizedBuffer[4] = 0x0d;
  oversizedBuffer[5] = 0x0a;
  oversizedBuffer[6] = 0x1a;
  oversizedBuffer[7] = 0x0a;

  const result = validateUploadFile("huge.png", "image/png", oversizedBuffer);
  assert.equal(result.valid, false);
  assert.match(result.error, /exceeds max size of 10MB/);
});

test("Upload Validation: folder sanitization prevents path traversal and special characters", () => {
  assert.equal(sanitizeFolderName("../../../etc/passwd"), "etc-passwd");
  assert.equal(sanitizeFolderName("user/uploads"), "user-uploads");
  assert.equal(sanitizeFolderName("valid_folder-123"), "valid_folder-123");
  assert.equal(sanitizeFolderName(""), "community-uploads");
  assert.equal(sanitizeFolderName(null), "community-uploads");
});
