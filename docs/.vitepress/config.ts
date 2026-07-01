import { defineConfig } from "vitepress";

export default defineConfig({
  title: "DataFoundry",
  description: "面向数据分析场景的 AI 工作台文档",
  lang: "zh-CN",
  base: "/DataFoundry/",
  srcDir: ".",
  srcExclude: ["README.md", "assets/**"],
  cleanUrls: false,
  themeConfig: {
    siteTitle: "DataFoundry",
    nav: [
      { text: "产品概览", link: "/zh/overview" },
      { text: "快速开始", link: "/zh/quick-start" },
      { text: "GitHub", link: "https://github.com/datagallery-lab/DataFoundry" }
    ],
    sidebar: [
      {
        text: "入门",
        items: [
          { text: "文档首页", link: "/zh/" },
          { text: "产品概览", link: "/zh/overview" },
          { text: "快速开始", link: "/zh/quick-start" },
          { text: "能力全览", link: "/zh/capabilities" }
        ]
      },
      {
        text: "使用指南",
        items: [
          { text: "Web 工作台", link: "/zh/guides/web-workbench" },
          { text: "TUI", link: "/zh/guides/tui" },
          { text: "数据源", link: "/zh/guides/data-sources" }
        ]
      },
      {
        text: "参考",
        items: [
          { text: "支持的数据源", link: "/zh/reference/supported-datasources" },
          { text: "REST API", link: "/zh/reference/rest-api" },
          { text: "配置 API", link: "/zh/reference/configuration-api" },
          { text: "Agent Runtime", link: "/zh/reference/agent-runtime" }
        ]
      },
      {
        text: "架构与安全",
        items: [
          { text: "架构概览", link: "/zh/architecture/overview" },
          { text: "安全说明", link: "/zh/security" }
        ]
      }
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/datagallery-lab/DataFoundry" }],
    search: {
      provider: "local"
    },
    footer: {
      message: "Apache-2.0 Licensed",
      copyright: "Copyright © DataGallery Lab"
    }
  }
});
