import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const need = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
};

const bucket = need('S3_BUCKET');
const origin = new URL(need('NEXT_PUBLIC_APP_URL')).origin;
const client = new S3Client({
  region: process.env['S3_REGION']?.trim() || 'us-east-1',
  endpoint: need('S3_ENDPOINT'),
  forcePathStyle: process.env['S3_FORCE_PATH_STYLE']?.trim() !== 'false',
  credentials: {
    accessKeyId: need('S3_ACCESS_KEY_ID'),
    secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
  },
});

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  console.info(`Bucket ${bucket} exists.`);
} catch {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.info(`Bucket ${bucket} created.`);
}
await client.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [origin],
          AllowedMethods: ['PUT', 'GET', 'HEAD'],
          AllowedHeaders: ['content-type'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3000,
        },
      ],
    },
  }),
);
console.info(`CORS on ${bucket} allows ${origin}.`);
client.destroy();
