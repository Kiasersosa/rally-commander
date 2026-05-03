// Object storage adapter — Cloudflare R2 via the S3-compatible API.
//
// Required env vars:
//   R2_ENDPOINT            e.g. https://<account-id>.r2.cloudflarestorage.com
//   R2_ACCESS_KEY_ID
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET              e.g. rally-commander
//
// Stored object key convention:
//   <team_id>/<event_id>/<document_id>/v<version>-<safe-filename>
// Falls back to <team_id>/orphans/<uuid> for documents not tied to an event.

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let _client: S3Client | undefined;

function client(): S3Client {
  if (_client) return _client;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 not configured: set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
    );
  }
  _client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

function bucket(): string {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error("R2_BUCKET not set");
  return b;
}

function safeFilename(name: string): string {
  return name
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type StoreObjectArgs = {
  teamId: string;
  eventId: string | null;
  documentId: string;
  versionNumber: number;
  filename: string;
  contentType: string;
  body: Uint8Array | Buffer;
};

export function buildStorageKey(args: {
  teamId: string;
  eventId: string | null;
  documentId: string;
  versionNumber: number;
  filename: string;
}): string {
  const safe = safeFilename(args.filename);
  if (args.eventId) {
    return `${args.teamId}/${args.eventId}/${args.documentId}/v${args.versionNumber}-${safe}`;
  }
  return `${args.teamId}/orphans/${args.documentId}/v${args.versionNumber}-${safe}`;
}

export async function putObject(args: StoreObjectArgs): Promise<{ key: string }> {
  const key = buildStorageKey(args);
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: args.body,
      ContentType: args.contentType,
    }),
  );
  return { key };
}

/**
 * Returns a presigned URL valid for `expiresInSeconds` seconds. We don't make
 * the bucket public — every download flows through a short-lived signed URL.
 */
export async function getSignedDownloadUrl(
  storageKey: string,
  expiresInSeconds = 60 * 5,
): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket(), Key: storageKey }),
    { expiresIn: expiresInSeconds },
  );
}

/**
 * Returns the raw bytes of an object — used server-side to extract text for
 * the diff after upload (we already have the bytes from the request, so this
 * is mostly for re-extraction or debug).
 */
export async function getObjectBytes(storageKey: string): Promise<Uint8Array> {
  const out = await client().send(
    new GetObjectCommand({ Bucket: bucket(), Key: storageKey }),
  );
  if (!out.Body) throw new Error(`R2 object empty: ${storageKey}`);
  const buf = await out.Body.transformToByteArray();
  return buf as Uint8Array;
}

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}
