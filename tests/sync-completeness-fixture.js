// 只用于随机 loopback origin 的合成数据；不打印任何凭据值。
export const APP_COUNT = 55
export const FIXTURE = {
  search: {provider: 'tavily', keys: {tavily: 'qa-search-credential'}, urls: {searxng: 'https://search.example.invalid'}},
  ai: {baseUrl: 'https://ai.example.invalid/v1', apiKey: 'qa-ai-credential', model: 'qa-model', extraBody: '{"metadata":{"source":"sync-qa"}}'},
  proxy: 'https://proxy.example.invalid/?url={url}',
  monitor: [{id: 'qa-monitor', name: 'QA 服务', kind: 'beszel', baseUrl: 'https://monitor.example.invalid', identity: 'qa@example.invalid', password: 'qa-monitor-credential', token: 'qa-monitor-token'}],
  ics: [{id: 'qa-calendar', name: 'QA 日历', url: 'https://calendar.example.invalid/private.ics', enabled: true}],
  app: {title: '加密业务数据', token: 'qa-app-token', nested: {keys: ['alpha', 'beta'], secret: 'qa-business-secret'}},
}
export const workspaceFixture = () => ({
  version: 6,
  theme: {active: 'qa-sync-theme', mode: 'dark', base: 'light'},
  themes: [
    {id: 'default', name: '默认', description: '', overrides: {}, builtin: true},
    {id: 'qa-sync-theme', name: '同步验收主题', description: '双模式合成主题', overrides: {main: '#7560c4'}, light: {bg: '#f4f1ff', text: '#211a35'}, dark: {bg: '#211a35', text: '#f4f1ff'}},
  ],
  pages: [{id: 'home', name: '同步验收首页', label: '首页', components: [], align: 'start', wallpaper: {mode: 'off'}, layers: [], css: 'background: linear-gradient(135deg, var(--bg), var(--bg2));'}],
  layout: {columns: 12, maxWidth: 1280}, widgets: [], applications: [],
  network: [{host: 'source-only.example.invalid', grantedAt: 1}], statusbar: [], addons: [], templates: [],
})
