import type { Attachment, AttachmentUploadResult } from "@copilotkit/shared";
import type { InputContent } from "@ag-ui/core";

export const CHAT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export const CHAT_ATTACHMENT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  ".csv",
  ".tsv",
  ".xlsx",
  ".json",
  ".parquet",
  ".txt",
  ".pdf",
  "text/csv",
  "text/tab-separated-values",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/json",
  "text/plain",
  "application/pdf",
].join(",");

export type ChatAttachmentCapabilities = {
  imageInput: boolean;
  fileUpload: boolean;
};

export const UNSUPPORTED_METADATA_KEY = "__chatUnsupported";

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export type UploadDataFile = (
  file: File,
) => Promise<{ path: string; mimeType: string; size: number }>;

export function createChatOnUpload(deps: {
  capabilities: () => ChatAttachmentCapabilities;
  readBase64: (file: File) => Promise<string>;
  uploadDataFile: UploadDataFile;
}) {
  return async (file: File): Promise<AttachmentUploadResult> => {
    const caps = deps.capabilities();
    if (isImageMime(file.type)) {
      const value = await deps.readBase64(file);
      return {
        type: "data",
        value,
        mimeType: file.type,
        metadata: caps.imageInput ? {} : { [UNSUPPORTED_METADATA_KEY]: true },
      };
    }
    if (!caps.fileUpload) {
      return {
        type: "url",
        value: "",
        mimeType: file.type,
        metadata: { [UNSUPPORTED_METADATA_KEY]: true },
      };
    }
    const uploaded = await deps.uploadDataFile(file);
    return {
      type: "url",
      value: uploaded.path,
      mimeType: uploaded.mimeType,
      metadata: {},
    };
  };
}

export function isAttachmentUnsupported(att: Attachment): boolean {
  return att.metadata?.[UNSUPPORTED_METADATA_KEY] === true;
}

export function attachmentToInputContent(att: Attachment): InputContent {
  const metadata = {
    ...(att.filename ? { filename: att.filename } : {}),
    ...att.metadata,
  };
  return { type: att.type, source: att.source, metadata } as InputContent;
}

export function buildMessageContent(
  text: string,
  attachments: Attachment[],
): InputContent[] {
  const sendable = attachments.filter((att) => !isAttachmentUnsupported(att));
  return [
    { type: "text", text } as InputContent,
    ...sendable.map(attachmentToInputContent),
  ];
}
