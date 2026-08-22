# 架构

`dsh-auto-approval-plugin` 的组成与请求处理流程。术语沿用 DSH 官方[审批 seam](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.md)（中文：[approval.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.zh.md)）：*请求* = 一次 `approval/request`；*回答器（answerer）* = 产出 `ApprovalOutcome` 的水瀑布监听器；*放行（grant）* = `allowed-once` 结果。

## 组件

| 文件 | 职责 |
|---|---|
| `lib/index.js` | Cordis 插件入口（`apply`）：行注册、`approval/request` 回答器、模型侧提示词叙述、配置 HTTP 面。 |
| `lib/decide.js` | 纯函数裁决核心（`classifyRequest`），零依赖、可独立单测。 |
| `lib/settings.js` | `auto-approval` 设置命名空间：schema、`mode` 词表、旧版迁移工具、校验。 |
| `lib/http.js` | 同源门控的 REST 处理器，供 Web 设置卡片使用。 |
| `client.js` | Web 客户端插件：设置侧栏的 Auto Approval 页面（`settings.section` 槽位）、i18n 词典、状态展示。 |
| `cordis.patch.yml` | Bundle patch：重述权限预设表并插入 `auto-approval` 行与其默认配置。 |

## 请求流程

```
工具调用（pwsh/bash/write/edit）
  └─ 沙箱拒绝，模型带 sandbox_permissions + justification 重试
       └─ dsh-tools → approval.request({agent, toolName, callId, reason})
            ├─ session.append("approval/asked", {id, toolName, callId})
            └─ ApprovalService.decide → ctx.waterfall("approval/request", ...)
                 ├─ 本插件回答器（prepend 先行）：
                 │    1. 有效配置（mode：off / gated 档位门控 / global）→ 未激活则 next()
                 │    2. findToolCall(session.events, callId, toolName) → 真实参数
                 │    3. classifyRequest → "allow" → 返回 "allowed-once"（链条终止）
                 │                    → "defer" / 异常 → next()
                 │    4. remember() + ctx.logger.info（审计辅助）
                 └─ 下一回答器（如 dsh-host-apiproxy → 浏览器弹窗）
                       → "allowed-once" | "rejected" | "cancelled" | "unavailable"
            └─ session.append("approval/decided", {id, outcome})   （审计对）
```

回答器**只**对能从会话日志 `tool/call` 参数中验证的请求返回 `"allowed-once"`；
其余一律 `next()`。插件永远不会产出 `rejected`/`cancelled`，因此不可能锁死会话。

## 裁决核心（`classifyRequest`）

按顺序检查，首个命中生效：

1. 工具不是 `pwsh`/`bash`/`write`/`edit` → `defer`
2. 参数缺失/超长 → `defer`
3. 命中 `dangerousPatterns` → `defer`（范围控制，命令与目标都先查）
4. 命令工具：
   - 不含 shell 元字符（`; & | < > ` ` $( 换行）时：
     - 命中 `harmlessPatterns` 且非 git/hub → 任意位置 `allow`
     - 命中 `harmlessPatterns` 且为 git/hub → 仅当 workdir ∈ 信任区域 → `allow`
     - workdir ∈ 信任区域 **且** 命令引用信任区域路径 → `allow`
   - 其余 → `defer`
5. fs 工具：解析后的目标 ∈ 信任区域 → `allow`；否则 `defer`

路径包含判定基于**真实身份**：最深已存在祖先经 realpath 解析（与 DSH
文件沙箱同一规范化机制），符号链接/junction 无法把目标偷渡出信任区域。

## 配置生命周期

```
cordis.patch.yml（组合基准层）            ← bundle patch，默认值
        ▼
auto-approval 设置命名空间                ← ~/.dsh/settings.yaml 用户层，
   （schema 默认 → base → 用户层）          热重载，Web 卡片写入此层
        ▼
effective() = normalizeConfig(resolved)  ← 旧布尔折叠为 mode
        ▼
每次决策边界读取                          ← 卡片修改即时生效
```

≤ 2.0.0 的旧文档（`enabled` / `requireTrustedPreset`）在每次读取时经
`normalizeConfig` 折叠为 `mode`；插件启动及旧客户端写入后各执行一次
一次性迁移（`replace`）清除落盘的旧键。

## 安全契约

- **绝不拒绝**：未命中、不支持、不可解析、出错请求一律 `next()` 转人工。
- **一次性**：`allowed-once` 只放行发起请求的那一次调用，会话常驻档位不变。
- **真实参数而非 justification**：裁决读取会话日志中按 `callId` 反查的
  `tool/call` 事件。
- **受控配置面**：配置 API 只接受回环（或已配置 `trustedHosts`）同源请求；
  `trustedHosts` 仅组合配置可设，无法经 API 自改。
- **先校验后落盘**：设置写入先经 schema 与 `assertValidEffectiveConfig`
  （信任区域必须为绝对路径、正则必须可编译）通过才会写盘。