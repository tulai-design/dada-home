import {DEFAULT_STACKS} from '../fonts'
import type {ThemeEntry} from '../workspace'

export const THEME_CATALOG_VERSION = 1
export type ThemeScope = 'shared' | 'light' | 'dark' | 'both' | 'recipe' | 'shell' | 'resource'
export type ThemeField = {
  path: string
  label: string
  description: string
  storage: string
  group: 'tokens' | 'recipes' | 'shell' | 'resources'
  type: 'color' | 'length' | 'font-stack' | 'number' | 'fonts'
  scopes: readonly ThemeScope[]
  storedShared?: boolean
  min?: number
  max?: number
  skins?: readonly string[]
  shells?: readonly string[]
  css?: string
  options?: readonly {value: string; label: string; storedValue?: string}[]
}

/** UI、按需发现与validator共用受控字体栈，不从自由CSS文本猜测字体来源。 */
export const FONT_STACK_OPTIONS = [
  ...(['sans', 'serif', 'mono'] as const).map(role => ({value: `system-${role}`, label: `${{sans: '界面', serif: '衬线', mono: '等宽'}[role]}系统后备`, storedValue: DEFAULT_STACKS[role]})),
  {value: 'system-ui', label: '浏览器系统界面字体'},
  {value: 'sans-serif', label: '浏览器无衬线后备'},
  {value: 'serif', label: '浏览器衬线后备'},
  {value: 'monospace', label: '浏览器等宽后备'},
  {value: 'Georgia, serif', label: 'Georgia 系统衬线'},
  {value: 'Arial, sans-serif', label: 'Arial 系统无衬线'},
  {value: '\"Helvetica Neue\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif', label: '主机系统字体栈'},
  {value: 'Tahoma, \"MS Sans Serif\", \"Microsoft YaHei\", sans-serif', label: '经典桌面系统字体栈'},
  ...(['sans', 'serif', 'mono'] as const).map(role => ({value: `var(--font-${role})`, label: `引用 ${role} 角色（不允许循环）`})),
] satisfies readonly {value: string; label: string; storedValue?: string}[]

const colors = {
  bg: ['主背景', '页面与主要画布的背景'],
  bg2: ['第二层背景', '分组与次级表面的背景'],
  bg3: ['第三层背景', '分隔、填充与更深层表面的背景'],
  text: ['主要文字', '正文与重要界面文字'],
  text2: ['次要文字', '辅助说明与次级文字'],
  text3: ['弱化文字', '占位与低强调说明'],
  text4: ['最弱文字', '禁用或极低强调内容'],
  border: ['边线', '控件与卡片的轻量边线'],
  rule: ['分隔线', '报头与主要结构分隔'],
  main: ['主题主色', '主要操作与强调；双模式修改建议选both'],
} as const
const switchColors = {
  red: '助手红', blue: '监控蓝', amber: '市场琥珀', muted: '设置弱色',
  'cover-ink': '封面文字', avatar: '头像背景', 'avatar-ink': '头像文字',
  'cover-blue': '蓝色封面', 'cover-red': '红色封面', 'cover-green': '绿色封面',
  'cover-amber': '琥珀封面', 'cover-violet': '紫色封面', focus: '封面焦点', orb: '主屏圆形按钮',
} as const
const winColors = {
  desktop: '桌面背景', face: '窗口面板', field: '输入底色', light: '凸边亮面',
  shadow: '凸边阴影', dark: '凸边暗线', title: '标题栏起色', 'title-end': '标题栏末色',
  'title-text': '标题栏文字', selection: '选中背景', 'selection-text': '选中文字',
} as const

type FieldSeed = Omit<ThemeField, 'description' | 'storage'> & {description?: string}
function field(seed: FieldSeed): ThemeField {
  const storage = seed.group === 'tokens' ? 'overrides（共享）或 light/dark（模式）；有效来源见两模式 resolve.sources'
    : seed.group === 'recipes' ? `recipes.${seed.path}；缺省沿用造型`
      : seed.group === 'shell' ? `shellConfig.${seed.path}；缺省沿用外壳默认` : 'fonts；undefined为默认字体，[]为明确系统后备'
  return {...seed, description: seed.description ?? `${seed.label}，仅影响已登记的宿主部件`, storage}
}
function color(path: string, label: string, description: string, skins?: readonly string[]): ThemeField {
  return field({path, label, description, group: 'tokens', type: 'color',
    scopes: skins?.includes('switch') ? ['shared', 'light', 'dark', 'both'] : ['light', 'dark', 'both'],
    ...(path === 'main' ? {storedShared: true} : {}), ...(skins ? {skins} : {}), css: `--${path}`})
}
function length(path: string, label: string, min: number, max: number): ThemeField {
  return field({path, label, group: 'tokens', type: 'length', scopes: ['shared'], min, max, css: `--${path}`})
}

export const THEME_FIELDS: readonly ThemeField[] = [
  ...Object.entries(colors).map(([path, [label, description]]) => color(path, label, description)),
  length('radius', '小部件圆角', 0, 24),
  length('radius-lg', '面板圆角', 0, 32),
  length('gutter', '内容留白', 8, 48),
  length('side-width', '侧栏宽度', 64, 120),
  ...['frame', 'frame-gap'].map(path => ({...length(path, path === 'frame' ? '外框粗细' : '外框留距', 0, 16), skins: ['paper', 'ios', 'pixel', 'switch'] as const})),
  {...color('frame-color', '外框颜色', '外框色；支持受控主色别名 var(--main)' ), scopes: ['shared'], skins: ['paper', 'ios', 'pixel', 'switch']},
  ...(['sans', 'serif', 'mono'] as const).map(role => field({path: `font-${role}`, label: `${{sans: '界面', serif: '标题正文', mono: '等宽'}[role]}字体栈`, description: '选择系统后备或目录中的角色别名；新网络字体走fonts资源，不写自由字体文本', group: 'tokens', type: 'font-stack', scopes: ['shared'], options: FONT_STACK_OPTIONS, css: `--font-${role}`})),
  ...Object.entries(switchColors).map(([name, label]) => color(`switch-${name}`, label, `主机造型的${label}`, ['switch'])),
  ...Object.entries(winColors).map(([name, label]) => color(`win98-${name}`, label, `经典桌面的${label}`, ['win98'])),
  ...(['button', 'input'] as const).map(part => field({path: `${part}.radius`, label: `${part === 'button' ? '按钮' : '输入框'}圆角`, description: '普通宿主业务控件的显式圆角；不重造桌面封面和标题栏', group: 'recipes', type: 'number', scopes: ['recipe'], min: 0, max: 24, css: `--recipe-${part}-radius`})),
  field({path: 'coverScale', label: '封面比例', description: '主机封面在现有响应式基准上的缩放百分比', group: 'shell', type: 'number', scopes: ['shell'], min: 80, max: 120, shells: ['switch'], css: '--switch-cover-scale'}),
  field({path: 'windowGap', label: '窗口边距', description: '经典桌面非最大化窗口距画布的期望边距；窄画布会安全收缩', group: 'shell', type: 'number', scopes: ['shell'], min: 4, max: 40, shells: ['win98']}),
  field({path: 'fonts', label: '字体资源', description: '最多4个结构化Google字体或已安装包的精确本地资源引用；空数组明确系统后备且不联网', group: 'resources', type: 'fonts', scopes: ['resource']}),
]

export function listThemeFields(theme: Pick<ThemeEntry, 'skin' | 'shell'>, group?: ThemeField['group']): ThemeField[] {
  return THEME_FIELDS.filter(item => (!group || item.group === group)
    && (!item.skins || item.skins.includes(theme.skin)) && (!item.shells || item.shells.includes(theme.shell)))
}
/** 小schema负责格式，字段范围/作用域和当前造型由同目录的运行validator核对。 */
export function themePatchJsonSchema(theme?: Pick<ThemeEntry, 'skin' | 'shell'>) {
  const fields = theme ? listThemeFields(theme) : THEME_FIELDS
  return {
    type: 'array', minItems: 1, maxItems: 32,
    items: {
      type: 'object', additionalProperties: false,
      properties: {
        path: {type: 'string', enum: fields.map(item => item.path), description: '字段用途/范围和适用作用域先按需describe_theme_schema'},
        scope: {type: 'string', enum: [...new Set(fields.flatMap(item => item.scopes))]},
        value: {anyOf: [
          {type: 'null'}, {type: 'number'}, {type: 'string', maxLength: 160},
          {type: 'array', maxItems: 4, items: {type: 'object', additionalProperties: false, properties: {family: {type: 'string', minLength: 1, maxLength: 40}, role: {type: 'string', enum: ['sans', 'serif', 'mono']}}, required: ['family']}},
        ]},
      }, required: ['path', 'scope', 'value'],
    },
  }
}
