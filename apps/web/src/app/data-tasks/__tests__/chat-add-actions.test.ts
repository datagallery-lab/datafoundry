import { describe, expect, it, vi } from "vitest";
import { buildChatAddActions } from "../components/chat/chat-add-actions";

describe("chat add actions", () => {
  it("puts file upload behind the unified plus menu", () => {
    const openFilePicker = vi.fn();
    const actions = buildChatAddActions({ openFilePicker });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      id: "upload-file",
      label: "上传文件",
      description: "添加图片、表格或文档到本次对话",
    });

    actions[0].run();
    expect(openFilePicker).toHaveBeenCalledOnce();
  });
});
