# Study Deck

支持导入题库的渐进式自学平台。题库以独立 JSON 文件提供，可按章节学习、搜索、收藏、记录进度，并在安装后离线使用。

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

Vite 使用相对资源路径，应用使用 HashRouter，因此可部署到任意项目级 Pages 路径。Service Worker 缓存应用壳，IndexedDB 保存已安装题库与学习状态。

## 题库契约

公开契约位于 [`schema/question-pack.schema.json`](schema/question-pack.schema.json)。导入器会拒绝：

- 超过 25 MB 或无法解析的文件；
- 未知 Schema 版本、重复题号、无效章节引用；
- 题目数量与 manifest 不一致；
- 非 HTTPS 的外部参考链接。

`tools/pack_extractor.py` 和 `tools/build_pack.py` 是无内容的通用转换工具。源文档、抽取结果、修订层和最终包可保存在独立内容仓库，不受本仓库 MIT 许可覆盖。
