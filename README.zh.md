# dsh-auto-approval-plugin

> 🌐 **语言**: [English](README.md) | 简体中文

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的中间权限档位：位于 **Workspace Write** 与 **Full access**（danger-full-access）之间。插件为权限设置新增 `auto-approval` 预设，并附带一个自动审批器：**自动放行无害命令**和**目标区域位于已配置信任区域**的操作（不局限于当前工作区），其余请求照常询问用户。

> ⚠️ **这是自动化的范围控制，不是安全边界。** 本插件只是把"人工点允许"这一步，对一小类可验证的请求自动化。DSH 沙箱仍然约束所有未升级的调用；被自动放行的调用仅在这一次调用上使用更宽模式（与人工点击允许产生的一次性授权完全一致）。请勿在你不放心让人类操作员执行命令的机器或会话上使用。

## 功能对比

| | Workspace Write | **Auto Approval（本插件）** | Full access |
|---|---|---|---|
| 沙箱模式 | `workspace-write` | `workspace-write` | `danger-full-access` |
| 审批策略 | `ask` | `ask` | `never` |
| 工作区/临时目录内写入 | 允许 | 允许 | 允许 |
| 无害命令（见规则表） | 询问 | **自动放行** | 不询问 |
| 目标在信任区域内的操作 | 询问 | **自动放行** | 不询问 |
| 其他一切 | 询问 | 询问 | 不询问 |

安装后，新预设会同时出现在两个权限入口：

- **General 设置 → Permission**：将 `auto-approval` 设为之后新会话的默认档位；
- **`/permission` 选择器**：立即切换当前会话（`/permission auto-approval`）。

## 工作原理

DSH 把所有需要审批的操作路由到 `approval/request` 水瀑布（[审批 seam](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/approval.md)）。本插件以 `prepend` 注册监听器，在网页审批弹窗前先裁决：

1. 对每个请求，按 `callId` 在会话日志中反查 `tool/call` 事件，读取**真实的工具参数**（命令文本、`file_path`、`workdir`）——绝不信任模型手写的 justification 字符串。
2. 纯函数决策核心（[`lib/decide.js`](lib/decide.js)）把请求分类为 `allow` 或 `defer`。
3. `allow` 返回 `allowed-once`——请求不会到达人工 UI；会话日志仍会写入 `approval/asked` + `approval/decided: allowed-once` 审计对，插件也会记录命中的规则。
4. `defer` 调用 `next()`——由部署的人工回答器照常裁决。**插件从不拒绝任何请求。**

## 安装

```bash
# 从 npm registry 安装
dsh plugin --profile <profile> add dsh-auto-approval-plugin
# 或从 GitHub 安装（建议锁定提交以保持可复现）
dsh plugin --profile <profile> add github:StyxNether/dsh-auto-approval-plugin#<commit>
```

## 配置

两层配置，都**即时生效（无需重启）**：

1. **Web 设置页**（最简单）：设置 → **Auto Approval**（设置侧边栏独立页面，与 Vision Toolkit 的"视觉工具"页同级）。在那里编辑信任区域（每行一个绝对路径）、无害/危险命令模式表、各开关；保存写入 `settings.yaml` 的 `auto-approval` 段并立即生效。页面还会显示最近几次自动放行记录。
2. **组合配置**（默认基准层）：在 profile 的 `cordis.patch.yml` 中设置：

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: auto-approval
  config:
    # 信任区域（绝对路径）。workdir 位于其中（且命令引用该区域）的命令，
    # 以及目标位于其中的 fs write/edit 会被自动放行。默认空：不配置即不生效。
    trustedAreas:
      - 'D:\data'
      - 'E:\repos'
    # 仅当会话当前预设为 `auto-approval` 时才自动放行。
    requireTrustedPreset: true
    # 对命令文本做大小写不敏感匹配的正则源。
    harmlessPatterns: [ ... ]   # 默认值见 lib/decide.js
    dangerousPatterns: [ ... ]  # 命中即转人工（绝不直接拒绝）
    maxCommandChars: 4000
    logDecisions: true
    # 允许访问配置 HTTP 接口的非回环主机（回环地址始终允许；跨站请求一律拒绝）。
    trustedHosts: []
```

设置值覆盖组合默认值；设置卡片会标记你已覆盖的字段，并提供一键恢复默认。

## 自动放行规则表

`pwsh` / `bash` 调用：

| 规则 | 条件 | 示例 |
|---|---|---|
| `harmless-command` | 纯只读内省命令，且不含 shell 元字符（`; & \| < > ` ` $( 换行） | `ls -la`、`Get-Process`、`whoami`、`echo hello` |
| `harmless-repo-command` | git/hub 只读命令 **且** workdir 位于信任区域 | 在 `D:\repos\app` 里执行 `git status`、`git branch` |
| `trusted-area-command` | workdir 位于信任区域 **且** 命令引用了信任区域路径 | workdir 为 `D:\data` 时执行 `Copy-Item D:\data\a D:\data\b` |

`write` / `edit`（fs）调用：

| 规则 | 条件 | 示例 |
|---|---|---|
| `trusted-area-target` | `file_path`（绝对路径，或相对会话 cwd/workdir 解析后）位于信任区域 | 向 `D:\data\out.txt` 执行 write |

其余一切——包括 `git pull`/`push`/`fetch`/`checkout`、`git diff`/`git log -p`（它们可能运行仓库配置的 textconv/pager 程序）、带重定向或管道的命令、信任区域之外的写入、以及所有其他工具——**一律转人工**。

### 刻意永不自动放行

- 含 shell 元字符的命令（重定向、管道、串联、命令替换）——"无害"窗口只接受单条简单命令。
- 会写入/拉取/合并的 git 操作，以及 `git diff`/`git log -p`——不可信仓库可借 `.git/config`（textconv、fsmonitor、pager）武器化 git，因此 git 自动放行要求 workdir 位于信任区域，且只限只读命令族。
- 命中 `dangerousPatterns` 的任何命令（系统盘/系统目录级删除、`rm -rf /`、`format`、`diskpart`、`shutdown`、目标在 `Windows`/`Program Files` 内的 fs 写入……）——即使在信任区域内也转人工。
- 在会话日志中查不到 `tool/call`、或参数缺失/超长的请求——无数据即不放行。

## 安全

- **无密钥。** 插件不含任何 API 密钥；网络访问仅限自身的同源配置接口；无 `eval`/动态代码；只读取自身配置与 settings 段。
- **可审计。** 每次自动放行都是一次性授权，写入会话日志（`approval/asked` + `approval/decided`），并有记录命中规则的日志行；设置卡片展示最近决策。
- **失败方向安全。** 决策路径出错时记录警告并转人工；插件不可能拒绝、阻断或锁死会话。
- **受控配置接口。** `GET/PUT /api/dsh-auto-approval-plugin/config` 只接受回环（或已配置 `trustedHosts`）的同源请求；跨站请求一律拒绝；只读写插件自己的 settings 命名空间。
- 威胁模型与报告方式见 [SECURITY.md](SECURITY.md)。

## 卸载（无残留）

1. 移除插件：`dsh plugin --profile <profile> remove dsh-auto-approval-plugin`
2. 删除 profile 的 `cordis.patch.yml` 中 `- id: auto-approval` 覆盖段（如曾添加）。
3. 删除 `settings.yaml` 中的 `auto-approval:` 段（设置卡片保存过才会有）。
4. 验证无残留：`dsh --profile <profile> --dump-config` 不应再有 `auto-approval` 行；`settings.yaml` 中不应再有 `auto-approval` 段。

除此之外不触碰任何其他文件、会话或凭据。

## 开发

```bash
npm test          # node:test 单元测试（决策核心）
npm run check     # 语法检查 + 测试
```

决策核心是不依赖任何第三方包的纯 JavaScript；插件本身是标准 Cordis 插件（见 `lib/index.js`）。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
