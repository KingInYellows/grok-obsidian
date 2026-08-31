import { z } from "zod/v4";

const metadataString = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), {
      message: "control characters are not allowed",
    })
    .refine((value) => value !== "---" && !value.includes("\n---"), {
      message: "frontmatter delimiters are not allowed in metadata",
    });

export const submitResearchNoteShape = {
  title: metadataString(160),
  body_markdown: z
    .string()
    .min(1)
    .max(50_000)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
      "unsupported control characters are not allowed",
    ),
  source_urls: z
    .array(
      z
        .string()
        .max(2_048)
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            (url.protocol === "https:" || url.protocol === "http:") &&
            url.username === "" &&
            url.password === ""
          );
        }, "source URLs must use HTTP(S) and cannot contain credentials"),
    )
    .max(25)
    .optional(),
  topic: metadataString(100).optional(),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u),
} as const;

export const submitResearchNoteSchema = z.strictObject(submitResearchNoteShape);

export const listSubmissionsShape = {
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(20).default(20),
} as const;

export const listSubmissionsSchema = z.strictObject(listSubmissionsShape);

export const receiptSchema = z.strictObject({
  note_id: z.string().regex(/^grn_[a-f0-9]{32}$/u),
  submitted_at: z.iso.datetime(),
  status: z.literal("accepted"),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const submissionMetadataSchema = receiptSchema.extend({
  title: z.string(),
  topic: z.string().optional(),
});

export const submissionPageSchema = z.strictObject({
  submissions: z.array(submissionMetadataSchema),
  next_cursor: z.string().optional(),
});

export const submissionRecordSchema = submissionMetadataSchema.extend({
  owner_subject: z.string().min(1).max(128),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u),
  request_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  filename: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,180}\.md$/u),
  temp_filename: z.string().regex(/^grn_[a-f0-9]{32}\.partial$/u),
});
