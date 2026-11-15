import { LABEL_PREFIX } from "../constants/labels";

/** Labels cannot contain whitespace; source IDs and releases are already safe. */
export const sanitizeLabel = (value: string): string => value.trim().replace(/\s+/g, "_");

export const srcLabel = (sourceId: string): string => `${LABEL_PREFIX.source}${sanitizeLabel(sourceId)}`;
export const kindLabel = (kind: string): string => `${LABEL_PREFIX.kind}${sanitizeLabel(kind)}`;
export const releaseLabel = (release: string): string => `${LABEL_PREFIX.release}${sanitizeLabel(release)}`;

/** Value of the first label with the given prefix (e.g. "src-REQ-04" → "REQ-04"). */
export const labelValue = (labels: readonly string[] | undefined, prefix: string): string | undefined =>
  labels?.find((label) => label.startsWith(prefix))?.slice(prefix.length);

export const sourceIdFromLabels = (labels: readonly string[] | undefined): string | undefined =>
  labelValue(labels, LABEL_PREFIX.source);
