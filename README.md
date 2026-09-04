# QD Study Platform

离线优先的量化开发与高性能 C++ 自学平台。平台代码和题库内容完全解耦：公开站点只包含应用壳与原创合成示例，真实题库通过本地 JSON 文件导入 IndexedDB。

## 本地运行

```bash
pnpm install
pnpm dev
```

质量检查：

```bash
pnpm check
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

## GitHub Pages

仓库内的 `deploy-pages.yml` 会在推送 `main` 后运行单元测试、构建并部署 `dist/`。首次使用时在仓库 Settings → Pages 中选择 **GitHub Actions** 作为 Source。

Vite 使用相对资源路径，应用使用 HashRouter，因此可部署到任意项目级 Pages 路径。第一次联网访问后，Service Worker 会缓存应用壳；导入的题库和学习状态保存在当前浏览器。

## 题库契约

公开契约位于 [`schema/question-pack.schema.json`](schema/question-pack.schema.json)。导入器会拒绝：

- 超过 25 MB 或无法解析的文件；
- 未知 Schema 版本、重复题号、无效章节引用；
- 题目数量与 manifest 不一致；
- 非 HTTPS 的外部参考链接。

`tools/qdpack_extractor.py` 和 `tools/build_qdpack.py` 是无内容的通用转换工具。真实 PDF、抽取结果、修订层和最终包应保存在私有内容仓库，不受本仓库 MIT 许可覆盖。
