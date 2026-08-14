window.__ModuleLoader__.load({
  id: 'dsh-auto-approval',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const CONFIG_PATH = '/api/dsh-auto-approval/config'
    const STATUS_PATH = '/api/dsh-auto-approval/status'
    const CSS_ID = 'dsh-auto-approval/card.css'
    const CSS = `
.aa-card{display:flex;flex-direction:column;gap:10px}
.aa-head{display:flex;align-items:center;gap:8px}
.aa-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.aa-badge{font-size:11px;line-height:17px;border-radius:999px;padding:1px 8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.aa-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}
.aa-field{display:flex;flex-direction:column;gap:6px}
.aa-label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}
.aa-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary)}
.aa-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 12px;font-size:13px;line-height:1.5;font-family:inherit}
.aa-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.aa-textarea{min-height:64px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12px}
.aa-error{color:var(--dsw-alias-label-error);font-size:12px;margin:0}
.aa-actions{display:flex;align-items:center;gap:8px}
.aa-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer;font-family:inherit}
.aa-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.aa-btn:disabled{cursor:default;opacity:.6}
.aa-btnPrimary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.aa-notice{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0}
.aa-recent{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0;font-family:ui-monospace,Consolas,monospace}
.aa-details{border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px}
.aa-summary{color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
`

    function errorMessage(error) {
      return error instanceof Error ? error.message : String(error)
    }

    async function responseJson(response) {
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    function fetchConfig() {
      return fetch(CONFIG_PATH, { headers: { accept: 'application/json' } }).then(responseJson)
    }

    function fetchStatus() {
      return fetch(STATUS_PATH, { headers: { accept: 'application/json' } }).then(responseJson)
    }

    function saveConfig(patch) {
      return fetch(CONFIG_PATH, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }).then(responseJson)
    }

    function linesToArray(text) {
      return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    }

    function arrayToLines(value) {
      return (value || []).join('\n')
    }

    function isAbsolutePath(value) {
      return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/')
    }

    function validateDraft(draft) {
      const problems = []
      for (const area of draft.trustedAreas) {
        if (!isAbsolutePath(area)) problems.push(`信任区域必须是绝对路径：${area}`)
      }
      for (const key of ['harmlessPatterns', 'dangerousPatterns']) {
        for (const source of draft[key]) {
          try { new RegExp(source, 'i') } catch (error) { problems.push(`${key} 中的正则无效：${source}（${errorMessage(error)}）`) }
        }
      }
      return problems
    }

    function ShieldIcon() {
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        React.createElement('path', {
          d: 'M8 1.5 13 3.5V7.8c0 3-2.2 5.2-5 6.7-2.8-1.5-5-3.7-5-6.7V3.5L8 1.5Z',
          fill: 'var(--dsw-alias-brand-primary)',
          fillOpacity: '.15',
          stroke: 'var(--dsw-alias-brand-primary)',
          strokeWidth: '1.2',
        }),
        React.createElement('path', {
          d: 'M5.5 8.2 7.2 9.9 10.8 6.2',
          stroke: 'var(--dsw-alias-brand-primary)',
          strokeWidth: '1.2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /**
     * The Trusted Auto configuration card. Reads and writes the plugin's own
     * settings namespace through the same-origin config API.
     */
    function AutoApprovalCard() {
      const [state, setState] = React.useState({ phase: 'loading' })
      const [draft, setDraft] = React.useState(null)
      const [advanced, setAdvanced] = React.useState(false)

      const load = () => {
        setState({ phase: 'loading' })
        Promise.all([fetchConfig(), fetchStatus()])
          .then(([config, status]) => {
            setDraft(JSON.parse(JSON.stringify(config.value)))
            setState({ phase: 'ready', config, status })
          })
          .catch((error) => setState({ phase: 'error', error: errorMessage(error) }))
      }

      React.useEffect(() => { load() }, [])

      if (state.phase === 'loading') {
        return React.createElement('div', { className: 'aa-hint' }, '加载中…')
      }
      if (state.phase === 'error') {
        return React.createElement('div', null,
          React.createElement('p', { className: 'aa-error' }, `配置加载失败：${state.error}`),
          React.createElement('div', { className: 'aa-actions' },
            React.createElement('button', { type: 'button', className: 'aa-btn', onClick: load }, '重试')))
      }

      const value = state.config.value
      const defaults = state.config.defaults
      const overridden = Object.keys(draft).some((key) => JSON.stringify(draft[key]) !== JSON.stringify(defaults[key]))
      const set = (key, next) => setDraft((current) => ({ ...current, [key]: next }))

      const onSave = () => {
        const problems = validateDraft(draft)
        if (problems.length > 0) {
          setState((current) => ({ ...current, error: problems.join('；') }))
          return
        }
        setState((current) => ({ ...current, saving: true, error: null, notice: null }))
        saveConfig(draft)
          .then((config) => {
            setDraft(JSON.parse(JSON.stringify(config.value)))
            setState({ phase: 'ready', config, saving: false, notice: '已保存（立即生效）' })
          })
          .catch((error) => setState((current) => ({ ...current, saving: false, error: `保存失败：${errorMessage(error)}` })))
      }

      const onReset = () => {
        setState((current) => ({ ...current, saving: true, error: null, notice: null }))
        saveConfig({ $reset: true })
          .then((config) => {
            setDraft(JSON.parse(JSON.stringify(config.value)))
            setState({ phase: 'ready', config, saving: false, notice: '已恢复默认' })
          })
          .catch((error) => setState((current) => ({ ...current, saving: false, error: `重置失败：${errorMessage(error)}` })))
      }

      const active = value.enabled && value.requireTrustedPreset
      const recent = (state.status?.recent || []).slice(-5).reverse()

      return React.createElement('div', { className: 'aa-card' },
        React.createElement('div', { className: 'aa-head' },
          ShieldIcon(),
          React.createElement('span', { className: 'aa-title' }, 'Trusted Auto 自动审批'),
          React.createElement('span', { className: 'aa-badge' }, active ? '配置生效' : '未启用'),
          overridden ? React.createElement('span', { className: 'aa-badge' }, '已自定义') : null),
        React.createElement('p', { className: 'aa-hint' },
          '介于 Workspace Write 与 Full access 之间的档位：无害命令与信任区域内的操作自动放行，其余照常询问。修改立即生效，无需重启。'),

        React.createElement('label', { className: 'aa-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: draft.enabled,
            onChange: (event) => set('enabled', event.target.checked),
          }),
          '启用自动审批'),

        React.createElement('label', { className: 'aa-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: draft.requireTrustedPreset,
            onChange: (event) => set('requireTrustedPreset', event.target.checked),
          }),
          '仅当会话档位为 Trusted Auto 时生效'),

        React.createElement('div', { className: 'aa-field' },
          React.createElement('span', { className: 'aa-label' }, '信任区域（每行一个绝对路径）'),
          React.createElement('textarea', {
            className: 'aa-input aa-textarea',
            rows: Math.max(2, draft.trustedAreas.length + 1),
            value: arrayToLines(draft.trustedAreas),
            placeholder: 'E:\\data\nD:\\projects',
            onChange: (event) => set('trustedAreas', linesToArray(event.target.value)),
          })),

        React.createElement('details', { className: 'aa-details', open: advanced, onToggle: (event) => setAdvanced(event.target.open) },
          React.createElement('summary', { className: 'aa-summary' }, '高级：命令模式表与其他'),
          React.createElement('div', { className: 'aa-field' },
            React.createElement('span', { className: 'aa-label' }, '无害命令模式（每行一条正则，大小写不敏感）'),
            React.createElement('textarea', {
              className: 'aa-input aa-textarea',
              rows: 4,
              value: arrayToLines(draft.harmlessPatterns),
              onChange: (event) => set('harmlessPatterns', linesToArray(event.target.value)),
            })),
          React.createElement('div', { className: 'aa-field' },
            React.createElement('span', { className: 'aa-label' }, '危险命令模式（命中即转人工，绝不自动放行）'),
            React.createElement('textarea', {
              className: 'aa-input aa-textarea',
              rows: 4,
              value: arrayToLines(draft.dangerousPatterns),
              onChange: (event) => set('dangerousPatterns', linesToArray(event.target.value)),
            })),
          React.createElement('div', { className: 'aa-field' },
            React.createElement('span', { className: 'aa-label' }, '判定长度上限（字符）'),
            React.createElement('input', {
              className: 'aa-input',
              type: 'number',
              min: 1,
              value: String(draft.maxCommandChars),
              onChange: (event) => set('maxCommandChars', Number(event.target.value) || 0),
            })),
          React.createElement('label', { className: 'aa-check' },
            React.createElement('input', {
              type: 'checkbox',
              checked: draft.logDecisions,
              onChange: (event) => set('logDecisions', event.target.checked),
            }),
            '记录每次自动放行日志')),

        state.error ? React.createElement('p', { className: 'aa-error' }, state.error) : null,
        state.notice ? React.createElement('p', { className: 'aa-notice' }, state.notice) : null,

        React.createElement('div', { className: 'aa-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'aa-btn aa-btnPrimary',
            disabled: state.saving,
            onClick: onSave,
          }, '保存'),
          React.createElement('button', {
            type: 'button',
            className: 'aa-btn',
            disabled: state.saving,
            onClick: onReset,
          }, '恢复默认')),

        recent.length > 0
          ? React.createElement('details', { className: 'aa-details' },
              React.createElement('summary', { className: 'aa-summary' }, `最近自动放行（${state.status.recent.length} 条，仅内存）`),
              recent.map((entry, index) => React.createElement('p', { key: index, className: 'aa-recent' },
                `${new Date(entry.time).toLocaleTimeString()} ${entry.toolName} ${entry.callId ?? ''} → ${entry.rule}`)))
          : null,
      )
    }

    function apply(ctx) {
      ctx.effect(() => {
        if (document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)) return
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-auto-approval'
        style.dataset.pluginCss = CSS_ID
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dsh-auto-approval: card styles')

      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        id: 'auto-approval',
        order: 5,
        label: 'Trusted Auto',
      }, () => React.createElement(AutoApprovalCard)))
    }

    const inject = ['slots']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
