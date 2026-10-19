import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { validateInternalApiAuth } from "@/lib/api-auth";
import {
  validateUploadFile,
  sanitizeFolderName,
  MAX_UPLOAD_BYTES,
} from "@/lib/upload-validation";

import { getSessionFromRequest } from "@/lib/server-auth";

const getCloudinaryConfig = () => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return null;
  }

  return { cloudName, apiKey, apiSecret };
};

const buildSignature = (folder: string, timestamp: number, apiSecret: string) => {
  const signaturePayload = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  return createHash("sha1").update(signaturePayload).digest("hex");
};

export async function POST(request: NextRequest) {
  // 1. Enforce user authentication or internal administrative authorization
  const session = getSessionFromRequest(request);
  const internalAuth = validateInternalApiAuth(request);

  if (!session.authenticated && !internalAuth.authorized) {
    return NextResponse.json(
      { error: "Unauthorized: You must be authenticated to upload files." },
      { status: 401 }
    );
  }

  // 2. Validate environment configuration
  const config = getCloudinaryConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Cloudinary is not configured on this environment." },
      { status: 500 }
    );
  }

  // 3. Parse and validate multipart form data
  const body = await request.formData().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = body.get("file");
  const folderInput = body.get("folder");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required." }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "File exceeds max size of 10MB." },
      { status: 413 }
    );
  }

  // 4. Read file buffer and verify MIME, extension, and magic bytes
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const validation = validateUploadFile(file.name, file.type, buffer);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error || "File validation failed." },
      { status: 400 }
    );
  }

  // 5. Sanitize folder name
  const folder = sanitizeFolderName(typeof folderInput === "string" ? folderInput : null);

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = buildSignature(folder, timestamp, config.apiSecret);

  // 6. Forward verified binary payload to Cloudinary
  const cloudinaryBody = new FormData();
  cloudinaryBody.append("file", file);
  cloudinaryBody.append("api_key", config.apiKey);
  cloudinaryBody.append("timestamp", String(timestamp));
  cloudinaryBody.append("folder", folder);
  cloudinaryBody.append("signature", signature);

  const uploadResponse = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/auto/upload`,
    {
      method: "POST",
      body: cloudinaryBody,
      cache: "no-store",
    }
  );

  const responsePayload = await uploadResponse.json().catch(() => null);
  if (!uploadResponse.ok || !responsePayload?.secure_url) {
    const errorMessage =
      responsePayload?.error?.message ||
      responsePayload?.error ||
      "Cloudinary upload failed";

    return NextResponse.json({ error: errorMessage }, { status: 502 });
  }

  return NextResponse.json(
    {
      url: responsePayload.secure_url as string,
      publicId: responsePayload.public_id as string,
      bytes: responsePayload.bytes as number,
      format: responsePayload.format as string,
      resourceType: responsePayload.resource_type as string,
    },
    { status: 200 }
  );
}
