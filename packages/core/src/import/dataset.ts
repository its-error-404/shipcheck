import { readFile } from "node:fs/promises";
import { z } from "zod";

export const TargetSchema = z.object({
  release: z.string(),
  commit: z.string(),
  prompt: z.string(),
  environment: z.string(),
  service: z.string(),
});
export type Target = z.infer<typeof TargetSchema>;

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

/** Loads and validates the dataset; fails fast with a readable message on any shape mismatch. */
export async function loadDataset(path: string): Promise<Dataset> {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const parsed = DatasetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Dataset ${path} does not match the expected schema:\n${z.prettifyError(parsed.error)}`);
  }
  const ids = new Set<string>();
  for (const r of parsed.data.records) {
    if (ids.has(r.source_id)) throw new Error(`Duplicate source_id in dataset: ${r.source_id}`);
    ids.add(r.source_id);
  }
  return parsed.data;
}
