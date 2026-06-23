# Tokenizer Cache Implementation Note

更新时间：2026-06-22
状态：基础缓存已实现；request path 预加载尚未实施

## Current Behavior

`packages/agent-runtime/src/context/token-counter.ts` 提供：

- `countTokens(text, modelName)`：异步加载 tokenizer；缺失时可从 Hugging Face 下载并写入 `.cache/tokenizers/`。
- `countTokensSync(text, modelName)`：只使用内存中已加载 tokenizer，否则执行保守字符估算；请求路径不会下载。

当前映射覆盖以下主要模型族；精确 pattern 与 tokenizer repository 以源码中的 `MODEL_TO_HF_ID` 为准：

| Model family | Example tokenizer source |
| --- | --- |
| Qwen / QwQ | Qwen2.5、Qwen3、Qwen Coder、QwQ repositories |
| DeepSeek | V2、V3/R1、V4、Coder、VL repositories |
| Llama / Gemma / Mistral | 对应开源 tokenizer repositories |
| GLM / Phi / Yi / MiniMax 等 | 对应 family fallback repositories |

fallback 估算为：每个 CJK 字符按一个 token，其他字符按每三个字符一个 token。下载、缓存读取或 encode 失败时
均回退估算，不阻塞 Agent。

## Runtime Boundary

当前 `StepContextPlanner` / `PromptTokenCounter` 使用同步计数，因此如果启动阶段没有预热对应 tokenizer，
`tokenReport.countQuality` 仍是 `estimated`。缓存能力已经存在，但不能把它描述为“所有生产 prompt 都已精确计数”。

## Cache

```text
.cache/tokenizers/
```

仓库通过 `.gitignore` 排除根目录和子目录 `.cache/`。同一进程内使用内存 cache 和共享 Promise 避免并发重复下载。

## Remaining Work

1. 启动阶段根据 `ModelContextProfileRegistry` 预热 tokenizer。
2. 将 `exact` / `family` / `estimated` 质量真实写入 prompt token report。
3. pin tokenizer revision，避免上游文件变化导致不可复现。
4. 增加 cache eviction、统计和离线部署策略。

## Verification

```bash
npm run typecheck
npm run smoke:context-compilation
npm run smoke:agent
```
