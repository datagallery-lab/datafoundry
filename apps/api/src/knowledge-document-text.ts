/**
 * Extract UTF-8 text from a knowledge-base upload.
 * Binary formats (PDF/Office/etc.) are rejected with a visible error — never mojibake-ingested.
 *
 * Gate is extension-whitelist based: MIME alone (including text/*) must not admit .pdf/.docx.
 */
const KNOWLEDGE_TEXT_EXTENSIONS = [
  ".txt",
  ".md",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
] as const;

const hasAllowedKnowledgeExtension = (filename: string): boolean => {
  const lower = filename.toLowerCase();
  return KNOWLEDGE_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

export const knowledgeDocumentTextFromFile = (
  filename: string,
  mimeType: string,
  body: Buffer,
): string => {
  if (!hasAllowedKnowledgeExtension(filename)) {
    throw new Error(
      `KNOWLEDGE_FILE_TYPE_UNSUPPORTED: Only text documents (.txt, .md, .csv, .tsv, .json, .yaml) are supported; `
        + `PDF/Office and other binary formats are not. Got: ${filename}`
    );
  }
  // Reject mislabeled binaries that would otherwise become mojibake in FTS.
  // mimeType is accepted for callers/logging but must not widen the allowlist.
  void mimeType;
  if (body.includes(0)) {
    throw new Error(
      `KNOWLEDGE_FILE_TYPE_UNSUPPORTED: File looks binary (contains null bytes). `
        + `Only UTF-8 text documents are supported. Got: ${filename}`
    );
  }
  return body.toString("utf8");
};
