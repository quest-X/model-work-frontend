# make-sense-v1 · 工作流宪法

## 2. 命名约定

**分支命名前缀只允许这 5 类**：
- `fix/<scope>-<descriptor>` — Mode B 修复
- `fix/unit<N>-<descriptor>` — Mode C 并行
- `<feature>/<sub-unit>` — Mode D 跨切面（e.g. `batch-import/u01-label-merge`）
- `perf/u<NN>-<descriptor>` — 性能专项
- `vX.Y.Z-<topic>` — Mode E 实验，归档加 `-archive` 后缀

**commit message 格式**：
```
type(scope?): subject — detail + detail + detail
```
- type：`feat | fix | chore | refactor | style | perf | release | revert`
- scope：可选，版本号（`v2.5.6`）或子模块（`export`）
- 用 em-dash `—` 不用 hyphen `-` 做分隔
- 多变更用 `+` 列举
- 主题英文 ≤10 词，中文 ≤20 字

---

## 3. 模型选择规则

| 模型 | 何时 | 历史样本 |
|------|------|---------|
| **Opus 4.6/4.7 (1M)** | 看 5+ 文件才能下手 / 跨文件 refactor / 大特性 | feat 多 (37+6) |
| **Sonnet 4.6** | 明确范围的小修 / chore 杂务 | fix 多 (34) |
| **Haiku 4.5** | i18n 翻译 / changelog 排版 / package.json | 暂未用 |

**经验法则**：大改（>500 行）人类审改回路必不可少 — 历史数据显示 AI 单独干大改容易"看似全做完但漏关键"。

---

## 4. 发版门槛（治版本号通胀 ⚠️）

历史问题：268 commit / 107 版本 = 平均每 2.5 commit 发一个版本，版本号失去信号。

**新规则**：
- **patch bump (`vX.Y.Z+1`)**：≥3 个相关 commit + 用户能感知 + 写得出一句话 changelog
- **minor bump (`vX.Y+1.0`)**：≥1 个新功能 (feat) 或攒满 5–8 个 patch
- **major bump (`vX+1.0.0`)**：架构级 / API 不兼容

**反例（不发版）**：单个样式调整、文案改、rename、typo、纯 chore。

`git tag v*` 命令会被 hook 拦截 — 距上个 tag <3 commit 时直接 block。要硬发版用 `/ready-to-bump` 检查后人工确认。

---

## 5. Hotspot 文件 — 改之前停一下

下面这些文件是反复返工区，再写"fix" 之前先想：是不是该做架构 review 了？

| 文件 | 历史改动 | 信号 |
|------|---------|------|
| `EditorContainer.tsx` | 114 次 | ★ 真正的 god file，下一阶段拆分 |
| `AutoSaveService.ts` | 20 次 | restore 链反复出血 |
| `ProjectRestoreService.ts` | 12 次 | 同上 |
| `FrameExtractorService.ts` | 16 次 | 视频架构持续演进 |

`restore` 关键词在 commit message 里出现 21 次 — 这不是普通 fix，是架构在说话。

---

## 6. 自动化（hooks 已装）

- **编辑 .ts/.tsx** → 自动跑 ESLint，错误反馈给我
- **Session 收尾** → 自动 git status + diff stat
- **`git tag v*`** → 检查 ≥3 commit 规则，否则 block

slash commands：
- `/audit-fanout` — Mode C 多 agent 并行
- `/short-fix` — Mode B 短分支
- `/exp-spike` — Mode E 实验侧枝（强制评估终点）
- `/ready-to-bump` — 检查"够不够发版"

---

## 7. AI-pair 工作流原则

1. **架构决策人写、日常打磨 AI 写** — 历史数据显示这是你已经在做的，显式化它
2. **每个任务先选 mode 再开干** — 不要默认 Mode A
3. **实验必须设评估终点** — Mode E 5 commit 内必须 keep/kill，不要无限拖
4. **删除和添加同等频繁** — v1.0.0 / v2.5.9 / retrieval 删除是好习惯，继续
5. **不要立刻发版** — 攒到能讲一个故事再 bump

---

_最后修改：2026-05-09 · 来源：从 271 个真实 commit 提炼_

整理日期：2026-10-23。仅调整文档表达与分卷；原有授权、事实日期和验收边界保持原范围。

同主题分卷：[概览与其他分卷](<CLAUDE.md>)。
