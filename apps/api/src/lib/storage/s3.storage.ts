import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectMetadata, ObjectStorage } from './storage.types';

export interface S3StorageOptions {
  endpoint?: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      // MinIO sanal-host adreslemeyi desteklemez; yol tabanlı zorunlu.
      ...(options.endpoint === undefined
        ? {}
        : { endpoint: options.endpoint, forcePathStyle: true }),
    });
  }

  presignPut(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    // `ContentType` imzaya dahil: istemci başka bir tiple yükleyemez.
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  presignGet(key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async head(key: string): Promise<ObjectMetadata | undefined> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        sizeBytes: res.ContentLength ?? 0,
        contentType: res.ContentType ?? null,
        etag: res.ETag ?? null,
      };
    } catch (error: unknown) {
      if (S3ObjectStorage.isNotFound(error)) return undefined;
      throw error;
    }
  }

  async get(key: string): Promise<Buffer | undefined> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (res.Body === undefined) return undefined;
      const bytes = await res.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error: unknown) {
      if (S3ObjectStorage.isNotFound(error)) return undefined;
      throw error;
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  private static isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const name = (error as { name?: unknown }).name;
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
  }
}
