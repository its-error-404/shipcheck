import { z } from "zod";

/** Record kinds present in the source dataset. */
export const RECORD_KINDS = ["manifest", "requirement", "evidence", "work"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const TargetSchema = z.object({
  release: z.string(),
  commit: z.string(),
  prompt: z.string(),
  environment: z.string(),
  service: z.string(),
});
export type Target = z.infer<typeof TargetSchema>;
export type TargetField = keyof Target;
export const TARGET_FIELDS: readonly TargetField[] = ["release", "commit", "service", "environment", "prompt"];

export const SourceRecordSchema = z.object({
  source_id: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string(),
  release: z.string(),
  recorded_status: z.string(),
  description: z.string(),
  comments: z.array(z.string()),
  links: z.array(z.string()),
});
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

export const DatasetSchema = z.object({
  dataset_label: z.string().min(1),
  target: TargetSchema,
  records: z.array(SourceRecordSchema).min(1),
  note: z.string().optional(),
});
export type Dataset = z.infer<typeof DatasetSchema>;
