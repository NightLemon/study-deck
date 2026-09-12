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

题目可省略 `sourcePages`，用于原创题、网页资料整理题等没有PDF页码的内容。提供时仍必须是两个正整数且起止顺序正确；`null`、空数组和非法页码会被拒绝。有页码题保留PDF展示，无页码题使用通用来源说明。一个题库可以混合两类题目，Schema版本仍为1，学习进度按稳定pack ID与题号保留。

本地完整内容验收可设置 `STUDY_PACK_PATHS` 为JSON路径数组后运行 `pnpm test:e2e`。测试从明确提供的本地文件读取私有题库，平台仓库只保留合成测试数据。没有设置该变量时，完整私有内容测试自动跳过。

课程目录直接来自题库的 `chapters[].sections`。可以按主题建章、按难度分节，点击小节即可筛选，并与搜索、收藏和学习状态组合使用。题目的 `id` 是稳定身份，目录位置由 `chapterId` / `sectionId` 指定；调整目录不用重编号，同 ID 升级保留收藏与学习状态。不存在的章节、小节及不匹配的所属关系仍会被拒绝。

`tools/pack_extractor.py` 和 `tools/build_pack.py` 是无内容的通用转换工具。源文档、抽取结果、修订层和最终包可保存在独立内容仓库，不受本仓库 MIT 许可覆盖。
