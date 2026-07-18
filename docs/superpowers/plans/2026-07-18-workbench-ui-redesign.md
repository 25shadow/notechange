# 云笔记迁移工作台界面改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将现有迁移页面改造成以登录、导出批次和最近操作日志为核心的中文单页工作台。

**Architecture:** 保留现有 `NoteChangeApi` 和主进程 IPC 契约；在渲染层增加轻量的日志状态、平台选择弹窗和导入动作选择。当前仅启用小米导出与 vivo 导入，其他方向在选择弹窗中显示为不可用，不修改 provider 实现。

**Tech Stack:** React 19、TypeScript、lucide-react、CSS、Vitest + Testing Library、Electron IPC。

---

### Task 1: 收敛 App 状态和平台选择模型

**Files:**
- Modify: `src/renderer/App.tsx`
- Test: `tests/unit/migration-wizard.test.tsx`

- [ ] **Step 1: 写出导出和导入选择状态的失败测试**

  覆盖：点击“导出笔记”打开选择器；小米登录时“导出小米笔记”可用；vivo 导出显示不可用；预览导入按钮打开目标平台选择器；未登录 vivo 时导入按钮不可用。

- [ ] **Step 2: 运行目标测试确认失败**

  `npm test -- --maxWorkers=1 tests/unit/migration-wizard.test.tsx`

- [ ] **Step 3: 在 App 中增加状态和日志模型**

  增加 `recentLogs`、`exportPickerOpen`、`importPickerOpen` 状态；实现 `appendLog(message, level)`，最多保留 8 条；所有登录、导出、删除和导入成功/失败路径写入中文日志。

- [ ] **Step 4: 移除旧确认状态和步骤引导状态**

  删除 `confirmed` 及其 setter、顶部步骤箭头相关渲染、`confirmMigration` 调用；导入按钮只依赖目标平台登录状态和当前导入状态。

- [ ] **Step 5: 运行目标测试确认通过**

  `npm test -- --maxWorkers=1 tests/unit/migration-wizard.test.tsx`

- [ ] **Step 6: 提交**

  `git add src/renderer/App.tsx tests/unit/migration-wizard.test.tsx && git commit -m "refactor: model platform actions and recent logs"`

### Task 2: 重做主页面布局和登录卡片

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/unit/migration-wizard.test.tsx`

- [ ] **Step 1: 写失败的结构测试**

  断言页面包含中文“最近操作”“小米云笔记”“vivo 原子笔记”“登录小米”“登录 vivo”；不包含步骤箭头文本、“需处理”和“我已核对目标账号和迁移数量”。

- [ ] **Step 2: 实现顶部日志区域**

  用日志面板替换旧 `nav.steps` 和隐私状态；显示最新日志在前，空状态显示“暂无操作记录”。

- [ ] **Step 3: 实现登录卡片**

  两张卡片只显示平台名称、账号标签、中文登录状态和登录按钮；已登录状态显示 `已登录`，按钮文案仍为“重新登录”。

- [ ] **Step 4: 删除主页面警告指标和迁移确认区域**

  表格只保留导出时间、笔记、附件和操作；移除 `warningCount` 的可见展示以及确认勾选行。

- [ ] **Step 5: 更新 CSS**

  使用日志栏、双卡片连接区和批次区的三段布局；移除 `.step`、`.transfer-rail`、`.confirmation-row` 等旧流程样式；保留移动端单列响应式和键盘焦点样式。

- [ ] **Step 6: 运行测试**

  `npm test -- --maxWorkers=1 tests/unit/migration-wizard.test.tsx`

- [ ] **Step 7: 提交**

  `git add src/renderer/App.tsx src/renderer/styles.css tests/unit/migration-wizard.test.tsx && git commit -m "feat: redesign migration workbench"`

### Task 3: 增加导出平台选择弹窗

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/unit/migration-wizard.test.tsx`

- [ ] **Step 1: 写失败测试**

  点击“导出笔记”后断言出现“导出小米笔记”和“导出 vivo 笔记”；未登录小米时小米选项禁用；选择小米后调用 `scanXiaomi` 并关闭弹窗。

- [ ] **Step 2: 实现 `PlatformPickerDialog` 内联组件**

  组件接收标题、选项、关闭回调和选择回调；选项显示平台状态、可用性和禁用原因。

- [ ] **Step 3: 接入小米导出**

  将现有“导出小米笔记”按钮改为“导出笔记”；选择小米时复用 `scan`，日志记录开始和完成数量；vivo 导出选项显示“暂未支持”。

- [ ] **Step 4: 提交**

  `git add src/renderer/App.tsx src/renderer/styles.css tests/unit/migration-wizard.test.tsx && git commit -m "feat: add export platform picker"`

### Task 4: 在预览页增加导入平台选择

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/ExportPreviewDialog.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/unit/export-preview-dialog.test.tsx`

- [ ] **Step 1: 写失败测试**

  断言预览工具栏左侧存在“导入”；点击后出现“导入到小米”和“导入到 vivo”；未登录 vivo 时 vivo 选项禁用。

- [ ] **Step 2: 扩展 `ExportPreviewDialog` props**

  增加 `vivoConnected`、`onRequestImport`、`importing` 和 `report` 所需的只读展示接口；不在预览组件内直接调用 IPC。

- [ ] **Step 3: 实现导入选择和现有 vivo 导入调用**

  App 接收选择结果，选择 vivo 时执行现有 `confirmMigration`（内部确认，不再显示复选框）和 `startImport`；选择小米显示“暂未支持”。

- [ ] **Step 4: 更新预览样式**

  将导入按钮放在预览左侧工具区，弹窗复用平台选择视觉样式；保留附件、搜索和删除功能。

- [ ] **Step 5: 运行组件测试**

  `npm test -- --maxWorkers=1 tests/unit/export-preview-dialog.test.tsx`

- [ ] **Step 6: 提交**

  `git add src/renderer/App.tsx src/renderer/ExportPreviewDialog.tsx src/renderer/styles.css tests/unit/export-preview-dialog.test.tsx && git commit -m "feat: choose import target from preview"`

### Task 5: 全量验证和界面回归

**Files:**
- Verify: `src/renderer/App.tsx`
- Verify: `src/renderer/ExportPreviewDialog.tsx`
- Verify: `src/renderer/styles.css`

- [ ] **Step 1: 运行全量测试和构建**

  `npm test -- --maxWorkers=1 && npm run typecheck && node scripts/validate-contracts.mjs && npm run build && git diff --check`

- [ ] **Step 2: 启动开发应用检查关键文案**

  确认主页面无箭头、无“需处理”、无核对勾选；确认导出和导入两个平台选择弹窗的中文文案正确。

- [ ] **Step 3: 检查工作区状态**

  `git status --short`

  预期只有开发运行产生的临时进程，无未提交代码。
