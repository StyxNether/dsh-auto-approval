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

> 插件未启用（`mode: off`）时，选择 Auto Approval 档位与 Workspace Write 完全相同——档位仍在入口中显示，但不会自动放行任何操作。

## 工作原理

DSH 把所有需要审批的操作路由到 `approval/request` 水瀑布（官方文档：[approval seam](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.md) / [中文版](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.zh.md)）。本插件以 `prepend` 注册监听器，在网页审批弹窗前先裁决：

1. 对每个请求，按 `callId` 在会话日志中反查 `tool/call` 事件，读取**真实的工具参数**（命令文本、`file_path`、`workdir`）——绝不信任模型手写的 justification 字符串。
2. 纯函数决策核心（[`lib/decide.js`](lib/decide.js)）把请求分类为 `allow` 或 `defer`；路径包含判定基于 realpath 解析后的真实身份（与 DSH 文件沙箱同一机制）。
3. `allow` 返回 `allowed-once`——请求不会到达人工 UI；会话日志仍会写入 `approval/asked` + `approval/decided: allowed-once` 审计对，插件也会记录命中的规则。
4. `defer` 调用 `next()`——由部署的人工回答器照常裁决。**插件从不拒绝任何请求。**

架构与请求/裁决流程的规范性说明见 [docs/architecture.zh.md](docs/architecture.zh.md)（[English](docs/architecture.md)）。

### 两层模型：Auto Approval 档位下 agent 的权限范围

该档位的权限范围可以精确拆成两层（架构文档里是七层的完整模型，这里是面向用户的简版）：

- **内层：workspace-write 执行边界**——与官方 Workspace Write 档位**完全一致，没有放宽**。DSH 沙箱对每次工具调用强制执行：会话工作区与平台临时目录内可写，其余文件/命令效应一律拒绝（读取任意文件不受限）。工作区内的操作由沙箱**直接放行，根本不产生审批请求**。
- **外层：自动审批策略（本插件）**——当一次操作被内层拒绝、agent 显式带 `sandbox_permissions` 发起升级请求后，插件在人工回答器**之前**先行裁决一小类"可验证安全"的请求并自动返回 `allowed-once`；其余请求原样转给人工。
- **没有第三层权限**：自动放行不等于把档位提到 Full access——被放行的调用只在**那一次**以 agent 请求的升级模式执行，会话常驻档位不变；插件从不拒绝任何请求。

换句话说：**Auto Approval ≠ Full access 的自动版**。它等于「Workspace Write 的沙箱范围 + 一个位于人工确认之前的自动裁决器」。

## 安装

```bash
# 从 npm registry 安装
dsh plugin --profile <profile> add dsh-auto-approval-plugin
# 或从 GitHub 安装（建议锁定提交以保持可复现）
dsh plugin --profile <profile> add github:StyxNether/dsh-auto-approval-plugin#<commit>
```

## 配置

两层配置，都**即时生效（无需重启）**：

1. **Web 设置页**（最简单）：设置 → **Auto Approval**（设置侧边栏独立页面）。页面只有一个主开关「启用自动审批」；启用后可二选一生效范围：「仅当会话档位为自动审批时生效」（默认）或「全局生效（不依赖会话档位）」。此外可编辑信任区域（每行一个绝对路径）、无害/危险命令模式表、判定长度上限与日志开关。保存写入 `settings.yaml` 的 `auto-approval` 段并立即生效。页面还会显示最近几次自动放行记录。
2. **组合配置**（默认基准层）：在 profile 的 `cordis.patch.yml` 中设置：

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: auto-approval
  config:
    # 主开关：off（关闭）| global（任意档位生效）| gated（仅当会话档位
    # 为 auto-approval 时生效）。安装后默认 gated。
    mode: gated
    # 信任区域（绝对路径）。workdir 位于其中（且命令引用该区域）的命令，
    # 以及目标位于其中的 fs write/edit 会被自动放行。默认空：不配置即不生效。
    trustedAreas:
      - 'D:\data'
      - 'E:\repos'
    # 对命令文本做大小写不敏感匹配的正则源。
    harmlessPatterns: [ ... ]   # 默认值见 lib/decide.js
    dangerousPatterns: [ ... ]  # 命中即转人工（绝不直接拒绝）
    maxCommandChars: 4000
    logDecisions: true
    # 允许访问配置 HTTP 接口的非回环主机（回环地址始终允许；跨站请求一律拒绝）。
    trustedHosts: []
```

> 旧版本（≤ 2.0.0）保存的 `enabled` / `requireTrustedPreset` 布尔配置会在读取时自动迁移为 `mode`（`off` / `global` / `gated`），无需手动处理。

设置值覆盖组合默认值；设置卡片会标记你已覆盖的字段，并提供一键恢复默认。

### 配置项详解（每个配置的作用与效果）

| 配置项 | 默认值 | 作用 | 改动它的效果 |
|---|---|---|---|
| `mode` | `gated` | 总开关 + 生效范围 | `off`：完全关闭自动审批（此时选择 Auto Approval 档位与 Workspace Write 完全相同）；`global`：任意档位下都自动审批；`gated`：仅当会话档位为 `auto-approval` 时自动审批 |
| `trustedAreas` | `[]` | 信任区域（绝对路径列表） | 为空时插件只剩下"无害内省命令"这一项能力；添加目录后，区内 git 只读命令、区内简单命令、区内 fs 写入获得自动放行（详见下文「安全区 vs 区外」） |
| `harmlessPatterns` | 只读内省集（见 `lib/decide.js`） | 判定"无害命令"的正则列表，命中（且无 shell 元字符）即自动放行 | 增加条目 = 更多命令免人工确认；删除条目 = 恢复人工确认。**建议只加只读、无副作用的命令**（读取面不应超过 DSH 自带的 `read` 工具） |
| `dangerousPatterns` | 高影响操作集（系统删除、提权、改 ACL、防火墙、注册表、持久化等） | 命中即转人工（**绝不自动放行**，但也绝不直接拒绝） | 增加条目 = 更多高危操作需要人工；减少条目 = 放宽自动窗口（**不建议**）。原则是"宁宽勿漏"：误拦只多一次人工确认，漏拦则可能自动放行破坏性命令 |
| `maxCommandChars` | `4000` | 命令/目标的判定长度上限，超长即转人工 | 调小 = 更长命令全部转人工；调大 = 允许更长命令参与自动裁决（注意判定成本与意外放行面） |
| `logDecisions` | `true` | 每次自动放行是否写入进程日志（`auto-approval: granted … (rule)`） | `false` 减少日志噪音，但失去规则级审计线索（会话日志里的 `approval/decided` 审计对仍会写） |
| `trustedHosts` | `[]` | 允许访问插件配置 HTTP 接口的非回环主机 | 不配置时仅回环（本机）可访问；加条目 = 允许从指定主机远程管理插件配置（跨站请求仍然一律拒绝） |

> 以上全部**即时生效**：settings.yaml 热加载、Web 卡片保存即应用，无需重启。

## 配置文件与日志位置

`$DSH_HOME` 默认是 `~/.dsh`（可用环境变量 `DSH_HOME` 覆盖）。本插件读写以下位置：

| 内容 | 位置 | 说明 |
|---|---|---|
| 插件自身组合默认值 | `<profile>/node_modules/dsh-auto-approval-plugin/cordis.patch.yml` | bundle patch（默认基准层），一般不用手改 |
| 组合覆盖层 | `~/.dsh/profiles/<profile>/cordis.patch.yml` | 手动添加 `- id: auto-approval` 段即可覆盖默认（见上方示例） |
| 用户设置（热加载） | `~/.dsh/settings.yaml` 的 `auto-approval:` 段 | Web 卡片保存的目标；**手动编辑保存即生效**，无需重启。先备份再编辑，保持 YAML 合法： |
| 会话审计日志 | `~/.dsh/sessions/<workspace>/<session-id>/session.jsonl.zstd` | zstd 压缩的 JSONL；每条自动放行都是 `approval/asked` + `approval/decided: allowed-once` 审计对。用 `zstd -d` 解压后查看 |
| 进程运行日志 | DSH 进程的标准错误（启动 harness 的终端/启动器） | 插件决策行以 `auto-approval:` 为前缀（如 `granted pwsh call ... (harmless-command)`）；错误/警告也在此 |
| 最近放行记录 | 仅内存（设置卡片展示最近 5 条） | 重启 DSH 后清空 |

`settings.yaml` 手改示例（保持 `mode` 语法）：

```yaml
auto-approval:
  mode: global                      # off | global | gated
  trustedAreas: ['D:\data', 'E:\repos']
  logDecisions: true
```

> 约定：手动编辑时不要写旧版 `enabled` / `requireTrustedPreset` 字段——虽然读取时会自动迁移，但再次打开卡片保存后会以 `mode` 形态重写。

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

### 「信任区域」的准确语义

信任区域**不是**"区内一切操作都放行"。逐请求的判定是：

- **放行**：`write`/`edit` 目标经解析后落在区内；或区内 `workdir` 执行的**无元字符**命令命中无害表（git/hub 只读族）或同时引用区内路径。
- **不放行**：即使 `workdir` 在区内，命令既不命中无害表也不引用区内路径（例如 `Invoke-WebRequest`）→ 转人工；含任何 shell 元字符（`; & | < > ` ` $( 换行）的命令 → 一律转人工；命中危险模式的任何命令或目标 → 一律转人工。
- **不经插件**：写入当前 DSH 工作区的操作由沙箱直接放行，根本不会产生审批请求。

### 安全区 vs 区外：实际特权对比

以 `D:\data` 为信任区域、`C:\work` 为会话工作区举例（区内指 workdir ∈ 区 / 目标 ∈ 区）：

| 操作 | 区外 | 区内（信任区域） |
|---|---|---|
| `git status`（在 `D:\data\repo` 里执行） | 转人工 | ✅ 自动放行 |
| `Copy-Item D:\data\a.txt D:\data\b.txt` | 转人工 | ✅ 自动放行 |
| `Remove-Item D:\data\build -Recurse`（清理构建产物） | 转人工 | ✅ 自动放行 |
| `write` / `edit` 到 `D:\data\…` | 转人工 | ✅ 自动放行 |
| `Get-Process` / `Get-Content` 等无害内省命令 | ✅ 自动放行 | ✅ 自动放行（无差别） |
| `echo hi > D:\data\x.txt`（含重定向） | 转人工 | 转人工（区不豁免元字符） |
| `Invoke-WebRequest http://…`（区内 workdir 但不引用区内路径） | 转人工 | 转人工（区不豁免任意命令） |
| `reg add` / `icacls` / `sudo …`（命中危险模式） | 转人工 | 转人工（区不豁免危险操作） |

安全区给出的特权只有三条：**区内 git 只读命令、区内执行的"简单单条命令"（无元字符且文本引用区内路径）、目标落在区内的 fs 写入**。它不豁免元字符、不豁免任意命令、不豁免危险模式。

### 刻意永不自动放行

- 含 shell 元字符的命令（重定向、管道、串联、命令替换）——"无害"窗口只接受单条简单命令；信任区域规则同样受此限制。
- 会写入/拉取/合并的 git 操作，以及 `git diff`/`git log -p`——不可信仓库可借 `.git/config`（textconv、fsmonitor、pager）武器化 git，因此 git 自动放行要求 workdir 位于信任区域，且只限只读命令族。
- 命中 `dangerousPatterns` 的任何命令或文件目标——默认表覆盖：系统盘/系统目录级删除、`rm -rf /`、`format`/`diskpart`、`shutdown`、目标在 `Windows`/`Program Files`/`ProgramData` 内的 fs 写入，以及 v2.1.0 起新增的**提权执行**（`sudo`/`gsudo`/`runas`/`Start-Process -Verb RunAs`/`psexec`）、**账号与权限变更**（`net user`/`net localgroup`/`*-LocalUser*`/ACL 工具 `icacls`/`takeown`/`Set-Acl`）、**安全控制变更**（防病毒 `*-MpPreference`、防火墙 `netsh`/`*-NetFirewall*`、`Set-ExecutionPolicy`）、**持久化**（`sc`、`*-Service`、`schtasks`、`*-ScheduledTask`）、**注册表与引导**（`reg add/delete/import/save/restore`、`regedit /s`、`bcdedit`）、**动态执行**（`Invoke-Expression`/`iex`/`-EncodedCommand`/`-enc`）、**日志清除**（`wevtutil cl`/`Clear-EventLog`）等——即使在信任区域内也转人工。默认表是"宁宽勿漏"（多拦只多一次人工确认，绝不拒绝）。
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
node scripts/verify-composition.js <profile>   # 离线校验组合配置与官方 schema
```

决策核心是不依赖任何第三方包的纯 JavaScript；插件本身是标准 Cordis 插件（见 `lib/index.js`）。架构说明见 [docs/architecture.zh.md](docs/architecture.zh.md)。相关官方资料：[扩展教程 extension-cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md)、[插件配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md)、[工具执行流水线](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-execution-pipeline.md)。
