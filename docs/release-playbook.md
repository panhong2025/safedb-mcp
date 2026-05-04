# SafeDB MCP — 版本发布操作手册

> 每次发版照着走一遍，不漏步骤。
> 适用于 patch / minor / major 所有版本类型。

---

## 零、发版前确认

在开始之前回答这三个问题：

| 问题 | 回答 |
|------|------|
| 这次发的是什么版本？ | patch（修 bug）/ minor（加功能）/ major（破坏性变更） |
| 新版本号是多少？ | 当前版本 → 新版本（如 1.1.0 → 1.2.0） |
| 上一轮 QA 的遗留项有没有要处理的？ | 查 `archives/05-qa-guardian_*` 最新存档的「建议改进项」 |

---

## 一、开发阶段（dev 分支）

### 1.1 代码开发

```bash
git checkout dev
git pull origin dev

# 开发...
npm test          # 随时跑测试
npm run build     # 确认编译
```

### 1.2 更新版本号（两处）

```bash
# 1. package.json
"version": "x.y.z"

# 2. src/server.ts — McpServer 初始化
const server = new McpServer({ name: "safedb-mcp", version: "x.y.z" });
```

> ⚠️ 这两处必须一致，QA 审核会查。

### 1.3 更新 CHANGELOG.md

在文件顶部（`## [1.0.0]` 之前）添加：

```markdown
## [x.y.z] - YYYY-MM-DD

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Deferred
- ...（如有从上版本延期的事项）
```

### 1.4 提交并推送

```bash
git add <具体文件>
git commit -m "feat: vx.y.z — 简要说明"
git push origin dev
```

---

## 二、QA 审核

### 2.1 运行自动化检查

```bash
npm test           # 所有测试通过
npm run build      # TypeScript 编译无错误
npm run lint       # ESLint 检查通过
npm run typecheck  # 类型检查通过
```

### 2.2 加载 QA Guardian 做全面体检

```
加载 05，对 vx.y.z 做全面体检
```

审核维度：安全 → 功能 → 商业化 → 性能 → 规范

### 2.3 修复阻断项

- 🔴 阻断项必须修复后才能继续
- 🟡 建议修复项记入下个版本 backlog
- 修复后重新提交到 dev

### 2.4 确认审核通过

存档保存为：`05-qa-guardian_SafeDB-MCP_vx.y.z_日期.md`

---

## 三、合入 main

### 3.1 创建 PR

```bash
gh pr create --base main --head dev \
  --title "Release vx.y.z" \
  --body "## Changes
- 变更点 1
- 变更点 2

## QA
- [x] 所有测试通过
- [x] QA Guardian 审核通过
- [x] 版本号已更新（package.json + server.ts）
- [x] CHANGELOG 已更新"
```

### 3.2 合入

```bash
# GitHub 上点 Merge，或命令行：
git checkout main
git pull origin main
git merge dev
git push origin main
```

---

## 四、npm 发布

### 4.1 确认状态

```bash
git checkout main
git pull origin main

# 最后一次确认
npm test && npm run build && npm run lint

# 预览包内容，确认无敏感信息
npm pack --dry-run
```

### 4.2 发布

```bash
# 如果开启了 2FA
npm publish --otp=123456

# 如果没有 2FA
npm publish
```

> `prepublishOnly` 钩子会自动先执行 `npm run build`。

### 4.3 验证发布成功

```bash
# 查看 npm 包信息
npm view safedb-mcp

# 测试安装
npx safedb-mcp
```

浏览器打开确认：https://www.npmjs.com/package/safedb-mcp

---

## 五、GitHub Release

### 5.1 打 tag

```bash
git tag vx.y.z
git push origin vx.y.z
```

### 5.2 创建 Release

```bash
gh release create vx.y.z \
  --title "vx.y.z" \
  --notes "$(cat <<'EOF'
## What's New

- 功能 1
- 功能 2

## Bug Fixes

- 修复 1

## Full Changelog

See [CHANGELOG.md](https://github.com/panhong2025/safedb-mcp/blob/main/CHANGELOG.md)

## Install

\`\`\`bash
npx safedb-mcp
\`\`\`
EOF
)"
```

或者在 GitHub 网页上操作：
1. 打开 https://github.com/panhong2025/safedb-mcp/releases/new
2. 选择刚推送的 tag
3. 标题填 `vx.y.z`
4. 描述从 CHANGELOG 复制
5. 点 Publish release

---

## 六、推广（可选，minor/major 版本建议做）

### 6.1 中文渠道

| 渠道 | 操作 | 适合 |
|------|------|------|
| CSDN | 发文章或更新已有文章 | 每个 minor 版本 |
| 掘金 | 发文章 | 重要功能更新 |
| V2EX | 发帖到 #程序员 节点 | 首发 / major 版本 |

### 6.2 英文渠道

| 渠道 | 操作 | 适合 |
|------|------|------|
| Reddit r/ClaudeAI | 发帖 + 演示截图 | 每个 minor 版本 |
| Reddit r/LocalLLaMA | 发帖 | 重要功能更新 |
| Twitter/X | 发推 + 截图 | 每个版本 |
| Hacker News | Show HN 帖子 | major 版本 / 里程碑 |

### 6.3 生态提交

| 目标 | 操作 | 状态 |
|------|------|------|
| awesome-mcp | 提 PR 加入数据库类目 | ⏳ 待提交 |
| MCP 官方 registry | 提交收录 | ⏳ 待确认入口 |

---

## 七、发版后收尾

### 7.1 同步 dev 分支

```bash
git checkout dev
git merge main
git push origin dev
```

### 7.2 生成存档

按 Agent 规范保存存档到 `archives/` 目录：
- `04-dev-pilot_SafeDB-MCP_vx.y.z_日期.md`
- `05-qa-guardian_SafeDB-MCP_vx.y.z_日期.md`

### 7.3 更新发布记录

在本文档末尾的「发布历史」表格中添加一行。

---

## 八、快速参考

### 完整命令序列（复制粘贴版）

```bash
# === dev 分支开发完毕后 ===
npm test && npm run build && npm run lint

# === 合入 main ===
git checkout main && git pull origin main
git merge dev && git push origin main

# === 发布到 npm ===
npm publish --otp=123456

# === 打 tag + GitHub Release ===
git tag vx.y.z && git push origin vx.y.z
gh release create vx.y.z --title "vx.y.z" --generate-notes

# === 同步 dev ===
git checkout dev && git merge main && git push origin dev
```

### 版本号规则

| 类型 | 场景 | 示例 |
|------|------|------|
| patch (x.y.**Z**) | 修 bug、更新文档 | 1.1.0 → 1.1.1 |
| minor (x.**Y**.0) | 新功能、新工具、不破坏兼容性 | 1.1.0 → 1.2.0 |
| major (**X**.0.0) | 破坏性变更（配置格式改变、删除工具等） | 1.1.0 → 2.0.0 |

---

## 九、发布历史

| 版本 | 日期 | 类型 | 主要变更 | npm | GitHub Release |
|------|------|------|---------|-----|----------------|
| 1.0.0 | 2026-05-04 | 首发 | 4 层安全防御、8 个 MCP 工具 | ✅ | ✅ |
| 1.1.0 | 2026-05-04 | minor | 测试覆盖率、社区文档、ESLint、Pro 链路 | ⏳ | ⏳ |
