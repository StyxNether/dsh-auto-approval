window.__ModuleLoader__.load({
  id: 'dsh-auto-approval',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const CONFIG_PATH = '/api/dsh-auto-approval/config'
    const STATUS_PATH = '/api/dsh-auto-approval/status'
    const NS = 'auto-approval'
    const CSS_ID = 'dsh-auto-approval/section.css'
    const CSS = `
.aa-card{display:flex;flex-direction:column;gap:12px;max-width:720px}
.aa-head{display:flex;align-items:center;gap:8px}
.aa-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
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
.aa-btnPrimary{border-color:var(--dsw-alias-brand-primary)}
.aa-notice{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0}
.aa-recent{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0;font-family:ui-monospace,Consolas,monospace}
.aa-details{border-top:1px solid var(--dsw-alias-border-l2);padding-top:12px}
.aa-summary{color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
`

    const en = {
      nav: 'Auto Approval',
      title: 'Auto Approval',
      desc: 'Between Workspace Write and Full access: harmless commands and operations whose target lies inside a trusted area are approved automatically; everything else asks. Works together with any permission mode when the preset gate is off.',
      badgeActive: 'Active',
      badgeInactive: 'Disabled',
      badgeCustom: 'Customized',
      enabled: 'Enable auto-approval',
      gate: 'Only when the session mode is Auto Approval',
      trustedAreas: 'Trusted areas (one absolute path per line)',
      advanced: 'Advanced: pattern tables and other',
      harmless: 'Harmless command patterns (one regex per line, case-insensitive)',
      dangerous: 'Dangerous command patterns (a match defers to the human, never auto-approves)',
      maxChars: 'Decision length limit (characters)',
      log: 'Log each auto-approval decision',
      save: 'Save',
      reset: 'Restore defaults',
      saved: 'Saved (applies immediately)',
      resetDone: 'Restored defaults',
      loading: 'Loading…',
      loadError: 'Failed to load configuration: ',
      retry: 'Retry',
      saveError: 'Save failed: ',
      resetError: 'Reset failed: ',
      validation: 'Validation: ',
      recentTitle: 'Recent auto-approvals ({count}, memory only)',
      invalidArea: 'must be an absolute path: ',
      invalidRegex: 'invalid regex in {key}: '
    }

    const zh = {
      nav: '自动审批',
      title: '自动审批',
      desc: '介于 Workspace Write 与 Full access 之间：无害命令与目标位于信任区域内的操作自动放行，其余照常询问。关闭档位门控后可与任意权限模式叠加生效。',
      badgeActive: '配置生效',
      badgeInactive: '未启用',
      badgeCustom: '已自定义',
      enabled: '启用自动审批',
      gate: '仅当会话档位为自动审批时生效',
      trustedAreas: '信任区域（每行一个绝对路径）',
      advanced: '高级：命令模式表与其他',
      harmless: '无害命令模式（每行一条正则，大小写不敏感）',
      dangerous: '危险命令模式（命中即转人工，绝不自动放行）',
      maxChars: '判定长度上限（字符）',
      log: '记录每次自动放行日志',
      save: '保存',
      reset: '恢复默认',
      saved: '已保存（立即生效）',
      resetDone: '已恢复默认',
      loading: '加载中…',
      loadError: '配置加载失败：',
      retry: '重试',
      saveError: '保存失败：',
      resetError: '重置失败：',
      validation: '校验：',
      recentTitle: '最近自动放行（{count} 条，仅内存）',
      invalidArea: '必须是绝对路径：',
      invalidRegex: '{key} 中的正则无效：'
    }

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
     * The Auto Approval settings section body. Reads and writes the plugin's
     * own settings namespace through the same-origin config API.
     */
    function AutoApprovalSection({ t }) {
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
        return React.createElement('div', { className: 'aa-hint' }, t('loading'))
      }
      if (state.phase === 'error') {
        return React.createElement('div', { className: 'aa-card' },
          React.createElement('p', { className: 'aa-error' }, t('loadError') + state.error),
          React.createElement('div', { className: 'aa-actions' },
            React.createElement('button', { type: 'button', className: 'aa-btn', onClick: load }, t('retry'))))
      }

      const value = state.config.value
      const defaults = state.config.defaults
      const overridden = Object.keys(draft).some((key) => JSON.stringify(draft[key]) !== JSON.stringify(defaults[key]))
      const set = (key, next) => setDraft((current) => ({ ...current, [key]: next }))

      const onSave = () => {
        const problems = []
        for (const area of draft.trustedAreas) {
          if (!isAbsolutePath(area)) problems.push(t('invalidArea') + area)
        }
        for (const key of ['harmlessPatterns', 'dangerousPatterns']) {
          for (const source of draft[key]) {
            try { new RegExp(source, 'i') } catch (error) { problems.push(t('invalidRegex').replace('{key}', key) + source) }
          }
        }
        if (problems.length > 0) {
          setState((current) => ({ ...current, error: t('validation') + problems.join('；') }))
          return
        }
        setState((current) => ({ ...current, saving: true, error: null, notice: null }))
        saveConfig(draft)
          .then((config) => {
            setDraft(JSON.parse(JSON.stringify(config.value)))
            setState({ phase: 'ready', config, saving: false, notice: t('saved') })
          })
          .catch((error) => setState((current) => ({ ...current, saving: false, error: t('saveError') + errorMessage(error) })))
      }

      const onReset = () => {
        setState((current) => ({ ...current, saving: true, error: null, notice: null }))
        saveConfig({ $reset: true })
          .then((config) => {
            setDraft(JSON.parse(JSON.stringify(config.value)))
            setState({ phase: 'ready', config, saving: false, notice: t('resetDone') })
          })
          .catch((error) => setState((current) => ({ ...current, saving: false, error: t('resetError') + errorMessage(error) })))
      }

      const active = value.enabled && value.requireTrustedPreset
      const recent = (state.status?.recent || []).slice(-5).reverse()

      return React.createElement('div', { className: 'aa-card' },
        React.createElement('div', { className: 'aa-head' },
          ShieldIcon(),
          React.createElement('span', { className: 'aa-title' }, t('title')),
          React.createElement('span', { className: 'aa-badge' }, active ? t('badgeActive') : t('badgeInactive')),
          overridden ? React.createElement('span', { className: 'aa-badge' }, t('badgeCustom')) : null),
        React.createElement('p', { className: 'aa-hint' }, t('desc')),

        React.createElement('label', { className: 'aa-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: draft.enabled,
            onChange: (event) => set('enabled', event.target.checked),
          }),
          t('enabled')),

        React.createElement('label', { className: 'aa-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: draft.requireTrustedPreset,
            onChange: (event) => set('requireTrustedPreset', event.target.checked),
          }),
          t('gate')),

        React.createElement('div', { className: 'aa-field' },
          React.createElement('span', { className: 'aa-label' }, t('trustedAreas')),
          React.createElement('textarea', {
            className: 'aa-input aa-textarea',
            rows: Math.max(2, draft.trustedAreas.length + 1),
            value: arrayToLines(draft.trustedAreas),
            placeholder: 'E:\\data\nD:\\projects',
            onChange: (event) => set('trustedAreas', linesToArray(event.target.value)),
          })),

        React.createElement('details', { className: 'aa-details', open: advanced, onToggle: (event) => setAdvanced(event.target.open) },
          React.createElement('summary', { className: 'aa-summary' }, t('advanced')),
          React.createElement('div', { className: 'aa-field' },
            React.createElement('span', { className: 'aa-label' }, t('harmless')),
            React.createElement('textarea', {
              className: 'aa-input aa-textarea',
              rows: 4,
              value: arrayToLines(draft.harmlessPatterns),
              onChange: (event) => set('harmlessPatterns', linesToArray(event.target.value)),
            })),
          React.createElement('div', { className: 'aa-field' },
            React.createElement('span', { className: 'aa-label' }, t('dangerous')),
            React.createElement('textarea', {
              className: 'aa-input aa-textarea',
              rows: 4,
              value: arrayToLines(draft.dangerousPatterns),
              onChange: (event) => set('dangerousPatterns', linesToArray(event.target.value)),
            })),
          React.createElement('div', { className: 'aa-field' },
            React.createElement('span', { className: 'aa-label' }, t('maxChars')),
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
            t('log'))),

        state.error ? React.createElement('p', { className: 'aa-error' }, state.error) : null,
        state.notice ? React.createElement('p', { className: 'aa-notice' }, state.notice) : null,

        React.createElement('div', { className: 'aa-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'aa-btn aa-btnPrimary',
            disabled: state.saving,
            onClick: onSave,
          }, t('save')),
          React.createElement('button', {
            type: 'button',
            className: 'aa-btn',
            disabled: state.saving,
            onClick: onReset,
          }, t('reset'))),

        recent.length > 0
          ? React.createElement('details', { className: 'aa-details' },
              React.createElement('summary', { className: 'aa-summary' },
                t('recentTitle').replace('{count}', String(state.status.recent.length))),
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
      }, 'dsh-auto-approval: section styles')

      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-auto-approval: locale')
      const t = ctx.locale.bind(NS)

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'auto-approval',
        order: 31,
        label: () => t('nav'),
        inject: () => ({ t }),
      }, (props) => React.createElement(AutoApprovalSection, { ...props, t })))
    }

    const inject = ['slots', 'locale']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
