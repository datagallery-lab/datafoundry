export type ChatAddAction = {
  id: string;
  label: string;
  description: string;
  run: () => void;
};

export function buildChatAddActions({
  openFilePicker,
}: {
  openFilePicker: () => void;
}): ChatAddAction[] {
  return [
    {
      id: "upload-file",
      label: "上传文件",
      description: "添加图片、表格或文档到本次对话",
      run: openFilePicker,
    },
  ];
}
