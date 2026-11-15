import { readFile } from "node:fs/promises";
import { z } from "zod";
import { DatasetSchema, type Dataset } from "../models/dataset";

/** Loads and validates the dataset; fails fast with a readable message on any shape mismatch. */
export const loadDataset = async (path: string): Promise<Dataset> => {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  const parsed = DatasetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Dataset ${path} does not match the expected schema:\n${z.prettifyError(parsed.error)}`);
  }
  const ids = new Set<string>();
  for (const record of parsed.data.records) {
    if (ids.has(record.source_id)) throw new Error(`Duplicate source_id in dataset: ${record.source_id}`);
    ids.add(record.source_id);
  }
  return parsed.data;
};
