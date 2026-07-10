import assert from "node:assert/strict";
import { knowledgeDocumentTextFromFile } from "../apps/api/dist/knowledge-document-text.js";

assert.equal(
  knowledgeDocumentTextFromFile("notes.md", "text/markdown", Buffer.from("# hi\n", "utf8")),
  "# hi\n",
);
assert.equal(
  knowledgeDocumentTextFromFile("rows.csv", "text/csv", Buffer.from("a,b\n1,2\n", "utf8")),
  "a,b\n1,2\n",
);
// Extension whitelist wins even when MIME is empty / generic.
assert.equal(
  knowledgeDocumentTextFromFile("notes.txt", "application/octet-stream", Buffer.from("plain\n", "utf8")),
  "plain\n",
);

let pdfError;
try {
  knowledgeDocumentTextFromFile("doc.pdf", "application/pdf", Buffer.from("%PDF-1.4", "utf8"));
} catch (error) {
  pdfError = error;
}
assert(pdfError instanceof Error, "PDF must be rejected");
assert.match(pdfError.message, /KNOWLEDGE_FILE_TYPE_UNSUPPORTED/);
assert.match(pdfError.message, /PDF\/Office/);

let forgedMimeError;
try {
  // Spoofed text MIME must not bypass the extension whitelist.
  knowledgeDocumentTextFromFile("doc.pdf", "text/plain", Buffer.from("not really a pdf", "utf8"));
} catch (error) {
  forgedMimeError = error;
}
assert(forgedMimeError instanceof Error, "forged text/plain PDF must be rejected");
assert.match(forgedMimeError.message, /KNOWLEDGE_FILE_TYPE_UNSUPPORTED/);

let docxError;
try {
  knowledgeDocumentTextFromFile(
    "report.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    Buffer.from("PK", "utf8"),
  );
} catch (error) {
  docxError = error;
}
assert(docxError instanceof Error, "DOCX must be rejected");
assert.match(docxError.message, /KNOWLEDGE_FILE_TYPE_UNSUPPORTED/);

let binaryError;
try {
  knowledgeDocumentTextFromFile("fake.txt", "text/plain", Buffer.from([0x00, 0x01, 0x02]));
} catch (error) {
  binaryError = error;
}
assert(binaryError instanceof Error, "null-byte body must be rejected");
assert.match(binaryError.message, /null bytes/);

console.log("knowledge-document-text smoke OK");
