import { pathToFileURL } from "node:url";
import {
  PutBucketLifecycleConfigurationCommand,
  PutBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { requiredEnv } from "./recovery-common.mjs";

function positiveDays(value, key, maximum = 3650) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > maximum)
    throw new Error(`${key} must be between 1 and ${maximum}`);
  return days;
}

function createClient(endpoint, region, accessKeyId, secretAccessKey) {
  return new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export function primaryLifecycleRules(noncurrentRetentionDays) {
  return [
    {
      ID: "abort-incomplete-multipart",
      Status: "Enabled",
      Filter: { Prefix: "" },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    },
    {
      ID: "retain-noncurrent-formal-assets",
      Status: "Enabled",
      Filter: { Prefix: "workspaces/" },
      NoncurrentVersionExpiration: { NoncurrentDays: noncurrentRetentionDays },
      Expiration: { ExpiredObjectDeleteMarker: true },
    },
  ];
}

export function backupLifecycleRules(retentionDays) {
  return [
    {
      ID: "expire-encrypted-object-snapshots",
      Status: "Enabled",
      Filter: { Prefix: "snapshots/" },
      Expiration: { Days: retentionDays },
      NoncurrentVersionExpiration: { NoncurrentDays: retentionDays },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    },
    {
      ID: "expire-backup-manifests",
      Status: "Enabled",
      Filter: { Prefix: "manifests/" },
      Expiration: { Days: retentionDays },
      NoncurrentVersionExpiration: { NoncurrentDays: retentionDays },
    },
  ];
}

async function configureBucket(client, bucket, rules) {
  await client.send(
    new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: { Rules: rules },
    }),
  );
}

export async function configureObjectLifecycle(env = process.env) {
  const region = requiredEnv(env, "S3_REGION");
  const primaryClient = createClient(
    requiredEnv(env, "S3_ENDPOINT"),
    region,
    requiredEnv(env, "S3_ACCESS_KEY_ID"),
    requiredEnv(env, "S3_SECRET_ACCESS_KEY"),
  );
  const backupClient = createClient(
    requiredEnv(env, "BACKUP_S3_ENDPOINT"),
    region,
    requiredEnv(env, "BACKUP_S3_ACCESS_KEY_ID"),
    requiredEnv(env, "BACKUP_S3_SECRET_ACCESS_KEY"),
  );
  try {
    await configureBucket(
      primaryClient,
      requiredEnv(env, "S3_BUCKET"),
      primaryLifecycleRules(
        positiveDays(
          requiredEnv(env, "OBJECT_NONCURRENT_RETENTION_DAYS"),
          "OBJECT_NONCURRENT_RETENTION_DAYS",
        ),
      ),
    );
    await configureBucket(
      backupClient,
      requiredEnv(env, "BACKUP_S3_BUCKET"),
      backupLifecycleRules(
        positiveDays(
          requiredEnv(env, "BACKUP_RETENTION_DAYS"),
          "BACKUP_RETENTION_DAYS",
          365,
        ),
      ),
    );
    console.log(JSON.stringify({ event: "object_lifecycle_configured" }));
  } finally {
    primaryClient.destroy();
    backupClient.destroy();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  configureObjectLifecycle().catch((error) => {
    console.error(
      JSON.stringify({
        event: "object_lifecycle_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    process.exitCode = 1;
  });
}
