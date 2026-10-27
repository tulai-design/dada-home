/**
 * 特效素材库目录。
 *
 * 这是一份纯数据：每个效果的 id、说明、可调参数及取值范围。
 * 它同时服务三方：
 *   1. AI —— list_effects 把这份目录原样给模型，模型据此组装效果；
 *   2. 校验 —— AI 给的参数不可信，进入工作空间前一律经过 normalizeParams；
 *   3. 渲染 —— views.tsx 按 id 找到对应的真实组件。
 *
 * 素材包含 React Bits 的本地改编与 Spline；历史副本来源/许可核对状态见 capabilities。
 * 新增一个素材：把组件放进 vendor，在这里登记参数，在 views.tsx 登记渲染。
 */

import {isColor} from '../lib/registry'
import {WorkspaceError} from '../lib/errors'
import {getFxCapability} from './capabilities'
import {FX_BUDGET_LIMITS, FX_COMPACT_LIMITS, FX_COMPACT_WIDTH} from './policy'

/**
 * 素材类别：
 * - background  铺满容器的动态背景（WebGL / Canvas），可作页面图层，也可作横幅块
 * - text        一段会动的文字，作为内容块
 * - card        带交互光效的卡片，作为内容块
 * - overlay     盖在整页上的质感层 / 点击反馈，只能作页面图层
 * - scene       Spline 3D 场景，可作页面图层，也可作内容块
 */
export type FxKind = 'background' | 'text' | 'card' | 'overlay' | 'scene'

export type FxParam =
  | {t: 'color'; label: string}
  | {t: 'colors'; label: string; max: number}
  | {t: 'number'; label: string; min: number; max: number}
  | {t: 'bool'; label: string}
  | {t: 'select'; label: string; options: string[]}
  | {t: 'string'; label: string; max: number}

export type FxDef = {
  id: string
  name: string
  kind: FxKind
  /** 给 AI 看：这个效果长什么样、适合放哪、不适合放哪 */
  description: string
  /** text 如何使用：line 一行；lines 每行一条（轮播/打字）；number 一个数字；body 首行标题其余正文；none 不用 */
  text: 'none' | 'line' | 'lines' | 'number' | 'body'
  params: Record<string, FxParam>
  /** 设计好的默认值；AI 不指定时用这些，保证开箱即好看 */
  defaults: Record<string, unknown>
}

const color = (label: string): FxParam => ({t: 'color', label})
const colors = (label: string, max = 6): FxParam => ({t: 'colors', label, max})
const num = (label: string, min: number, max: number): FxParam => ({t: 'number', label, min, max})
const bool = (label: string): FxParam => ({t: 'bool', label})
const sel = (label: string, options: string[]): FxParam => ({t: 'select', label, options})
const str = (label: string, max = 200): FxParam => ({t: 'string', label, max})

/** 所有文字类效果共有的排版参数，由外层容器处理。 */
const TYPE: Record<string, FxParam> = {
  size: num('字号 px', 12, 240),
  weight: num('字重 100-900', 100, 900),
  font: sel('字体', ['serif', 'sans', 'mono']),
  align: sel('对齐', ['left', 'center', 'right']),
  color: color('文字颜色'),
}
const TYPE_DEFAULTS = {size: 44, weight: 500, font: 'serif', align: 'left'}

export const FX_DEFS: FxDef[] = [
  // ───────────── 背景 ─────────────
  {
    id: 'aurora',
    name: '极光',
    kind: 'background',
    description: '大面积流动的极光带，柔和、有呼吸感。适合首页整页背景，配 2-3 个色。',
    text: 'none',
    params: {
      colorStops: colors('极光色带（2-4 个颜色）', 4),
      amplitude: num('起伏幅度', 0.2, 3),
      blend: num('边缘柔和度 0-1', 0, 1),
      speed: num('流速', 0, 4),
      glow: num('辉光', 0, 2),
      brightness: num('亮度', 0.2, 2.5),
      layers: num('层数', 1, 3),
      direction: sel('升起方向', ['top', 'bottom']),
      opacity: num('不透明度', 0, 1),
      mouseInteraction: bool('跟随鼠标'),
    },
    defaults: {colorStops: ['#ff5a3c', '#ffb86b', '#7c5cff'], amplitude: 1, blend: 0.6, glow: 0.5, opacity: 0.9},
  },
  {
    id: 'silk',
    name: '丝绸',
    kind: 'background',
    description: '像丝绸起伏的单色流体。克制、高级，适合做横幅或整页安静背景。',
    text: 'none',
    params: {
      color: color('底色'),
      sheenColor: color('高光色'),
      speed: num('流速', 0, 12),
      scale: num('纹理缩放', 0.3, 4),
      noiseIntensity: num('颗粒', 0, 4),
      rotation: num('旋转角度', 0, 360),
      sheen: num('光泽', 0, 1),
      depth: num('起伏深度', 0, 1),
      glow: num('辉光', 0, 1),
      wave: num('波纹', 0, 3),
      mouseInteraction: bool('跟随鼠标'),
      clickRipple: bool('点击涟漪'),
      fade: num('边缘渐隐', 0, 1),
    },
    defaults: {color: '#d9cdb8', sheenColor: '#fffaf0', speed: 3, noiseIntensity: 1, fade: 0.2},
  },
  {
    id: 'beams',
    name: '光束',
    kind: 'background',
    description: '一束束斜向流动的光柱，有舞台感。深色主题下最出效果，适合横幅或首页背景。',
    text: 'none',
    params: {
      color: color('光束颜色'),
      backgroundColor: color('底色'),
      beamWidth: num('光束宽度', 20, 400),
      rotation: num('倾斜角度', 0, 360),
      speed: num('流速', 0, 5),
      waveLength: num('波长', 50, 600),
      sharpness: num('锐度', 0, 1),
      twist: num('扭曲', -2, 2),
      glow: num('辉光', 0, 2),
      brightness: num('亮度', 0.2, 3),
      grain: num('颗粒', 0, 1),
      quality: num('渲染质量', 0.3, 1),
      mouseInteraction: bool('跟随鼠标'),
      fade: num('边缘渐隐', 0, 1),
      opacity: num('不透明度', 0, 1),
    },
    defaults: {color: '#ff6a4d', backgroundColor: '#14100e', brightness: 1.4, grain: 0.25, textColor: '#f4efe6'},
  },
  {
    id: 'galaxy',
    name: '星系',
    kind: 'background',
    description: '缓缓旋转的星空，鼠标靠近星星会被推开。适合暗色主题的整页背景。',
    text: 'none',
    params: {
      starColors: colors('星光颜色', 4),
      backgroundColor: color('夜空底色'),
      density: num('星星密度', 0.3, 3),
      starSpeed: num('星速', 0, 3),
      speed: num('整体速度', 0, 3),
      hueShift: num('色相偏移 0-360', 0, 360),
      saturation: num('饱和度', 0, 1.5),
      glowIntensity: num('辉光', 0, 1.5),
      twinkleIntensity: num('闪烁', 0, 1),
      rotationSpeed: num('旋转速度', 0, 1),
      starSize: num('星星大小', 0.3, 3),
      layers: num('景深层数', 1, 6),
      direction: sel('飞行方向', ['forward', 'backward']),
      mouseRepulsion: bool('鼠标排斥'),
      clickWarp: bool('点击跃迁'),
      transparent: bool('透明底'),
      opacity: num('不透明度', 0, 1),
    },
    defaults: {density: 1, hueShift: 20, transparent: false, backgroundColor: '#0d0b10', textColor: '#f4efe6'},
  },
  {
    id: 'iridescence',
    name: '虹彩',
    kind: 'background',
    description: '肥皂泡般的虹彩流光，色彩丰富但柔和。适合整页背景或横幅，亮暗主题都好看。',
    text: 'none',
    params: {
      color: color('基调色'),
      speed: num('流速', 0, 3),
      amplitude: num('起伏', 0, 0.5),
      scale: num('缩放', 0.3, 4),
      warp: num('扭曲', 0, 3),
      hueShift: num('色相偏移 0-360', 0, 360),
      saturation: num('饱和度', 0, 2),
      brightness: num('亮度', 0.3, 2.5),
      contrast: num('对比度', 0.3, 2.5),
      stir: num('搅动', 0, 2),
      sheen: num('光泽', 0, 1),
      grain: num('颗粒', 0, 1),
      fade: num('边缘渐隐', 0, 1),
      opacity: num('不透明度', 0, 1),
      mouseReact: bool('跟随鼠标'),
      clickSwirl: bool('点击漩涡'),
    },
    defaults: {color: '#ffd9c7', brightness: 1.3, saturation: 0.55, opacity: 0.85, fade: 0.1},
  },
  {
    id: 'liquid-chrome',
    name: '液态金属',
    kind: 'background',
    description: '银色液态金属表面，随鼠标泛起涟漪。很炫，适合展示型横幅，不适合放在文字密集的页面后面。',
    text: 'none',
    params: {
      color: color('金属色调'),
      speed: num('流速', 0, 1.5),
      amplitude: num('起伏', 0.05, 1),
      frequencyX: num('横向频率', 1, 8),
      frequencyY: num('纵向频率', 1, 8),
      detail: num('细节层级', 1, 8),
      thickness: num('厚度', 0.3, 2),
      roughness: num('粗糙度', 0, 1),
      exposure: num('曝光', 0.3, 2.5),
      interactive: bool('鼠标涟漪'),
      rippleStrength: num('涟漪强度', 0, 3),
    },
    defaults: {color: '#e8dfd2', speed: 0.15, exposure: 1.1},
  },
  {
    id: 'orb',
    name: '光球',
    kind: 'background',
    description: '一个会呼吸、跟随鼠标的发光球体，居中出现。适合做首页视觉焦点或安静的横幅。',
    text: 'none',
    params: {
      colors: colors('球体渐变色（3 个）', 3),
      backgroundColor: color('背景色'),
      size: num('大小', 0.3, 1.5),
      glow: num('辉光', 0, 2),
      wobble: num('晃动', 0, 2),
      speed: num('速度', 0, 3),
      hoverIntensity: num('悬停反应', 0, 3),
      rotateOnHover: bool('悬停旋转'),
      followCursor: bool('跟随鼠标'),
      clickPulse: bool('点击脉冲'),
      opacity: num('不透明度', 0, 1),
    },
    defaults: {colors: ['#ff6a4d', '#ffcf7a', '#5b4bff'], backgroundColor: 'rgba(0,0,0,0)', size: 0.9},
  },
  {
    id: 'particles',
    name: '粒子',
    kind: 'background',
    description: '漂浮的粒子云，鼠标移动时产生视差或排斥。可连线成星座。适合整页背景。',
    text: 'none',
    params: {
      particleColors: colors('粒子颜色', 5),
      particleCount: num('数量', 30, 600),
      particleSpread: num('分布范围', 4, 20),
      speed: num('速度', 0, 1),
      particleBaseSize: num('粒子大小', 20, 300),
      shape: sel('形状', ['circle', 'square', 'ring', 'sparkle']),
      glow: num('辉光', 0, 2),
      twinkle: num('闪烁', 0, 1),
      connections: bool('粒子连线'),
      hoverEffect: sel('悬停效果', ['parallax', 'repel', 'attract']),
      drift: sel('漂移方向', ['none', 'up', 'down', 'forward']),
      clickBurst: bool('点击迸发'),
      opacity: num('不透明度', 0, 1),
    },
    defaults: {particleColors: ['#e5372e', '#1b1714'], particleCount: 160, particleBaseSize: 90, shape: 'circle'},
  },
  {
    id: 'threads',
    name: '丝线',
    kind: 'background',
    description: '一束细线像发丝般缠绕流动，线条感强，非常编辑部风格。适合浅色纸张主题下的横幅或整页背景。',
    text: 'none',
    params: {
      color: color('线色'),
      accentColor: color('强调色'),
      amplitude: num('起伏', 0.2, 4),
      distance: num('距离', 0, 1.5),
      lineCount: num('线条数', 10, 200),
      thickness: num('线粗', 0.1, 3),
      softness: num('柔和度', 0.2, 3),
      speed: num('流速', 0, 3),
      waves: num('波数', 0.3, 3),
      angle: num('倾角', -90, 90),
      brightness: num('亮度', 0.3, 3),
      fade: num('边缘渐隐', 0, 1),
      opacity: num('不透明度', 0, 1),
      enableMouseInteraction: bool('跟随鼠标'),
    },
    defaults: {color: '#1b1714', accentColor: '#e5372e', brightness: 1.1, lineCount: 70, fade: 0.2},
  },
  {
    id: 'waves',
    name: '波纹线',
    kind: 'background',
    description: '一整面细线组成的起伏波浪，鼠标经过会被拨动。像等高线或地形图，很适合编辑风。',
    text: 'none',
    params: {
      lineColor: color('线色'),
      accentColor: color('强调色'),
      backgroundColor: color('底色（transparent 为透明）'),
      lineStyle: sel('线型', ['solid', 'dashed']),
      spacing: num('线间距 px', 4, 40),
      lineWidth: num('线宽', 0.5, 4),
      rotation: num('旋转角度', 0, 360),
      amplitude: num('起伏幅度', 4, 100),
      scale: num('缩放', 0.3, 3),
      twist: num('扭曲', 0, 3),
      speed: num('流速', 0, 3),
      mouseInteraction: bool('鼠标拨动'),
      clickRipple: bool('点击涟漪'),
      fade: num('边缘渐隐', 0, 1),
      opacity: num('不透明度', 0, 1),
    },
    defaults: {lineColor: '#1b1714', accentColor: '#e5372e', spacing: 12, lineWidth: 0.8, opacity: 0.35, fade: 0.3},
  },
  {
    id: 'dot-grid',
    name: '点阵',
    kind: 'background',
    description: '规整的圆点网格，鼠标靠近时圆点被推开、点击产生冲击波。像方格纸，极具设计感。',
    text: 'none',
    params: {
      baseColor: color('圆点底色'),
      activeColor: color('受扰动时的颜色'),
      dotSize: num('点大小 px', 2, 14),
      gap: num('点间距 px', 8, 48),
      proximity: num('感应半径', 40, 400),
      strength: num('推力', 0, 3),
      glow: num('辉光', 0, 1),
      shape: sel('形状', ['circle', 'square']),
      mouseInteraction: bool('鼠标扰动'),
      clickShock: bool('点击冲击波'),
      fade: num('边缘渐隐', 0, 1),
      opacity: num('不透明度', 0, 1),
    },
    defaults: {baseColor: '#cfc6b8', activeColor: '#e5372e', dotSize: 3, gap: 20, opacity: 0.9, fade: 0.3},
  },

  // ───────────── 文字 ─────────────
  {
    id: 'split-text',
    name: '分字入场',
    kind: 'text',
    description: '文字按字/词逐个入场，多种动势。最适合做大标题。text 为一行标题。',
    text: 'line',
    params: {
      ...TYPE,
      effect: sel('动势', ['rise', 'fade', 'blur', 'flip', 'pop', 'skew', 'wave']),
      splitType: sel('拆分方式', ['chars', 'words', 'lines']),
      trigger: sel('触发', ['view', 'load', 'hover', 'click']),
      delay: num('逐个间隔 ms', 10, 300),
      duration: num('单个时长 s', 0.2, 3),
      loop: bool('循环播放'),
      accentColor: color('强调色'),
      mask: bool('遮罩上升'),
    },
    defaults: {...TYPE_DEFAULTS, effect: 'rise', splitType: 'chars', trigger: 'load', delay: 40},
  },
  {
    id: 'blur-text',
    name: '模糊显影',
    kind: 'text',
    description: '文字从模糊中逐词显影，温和优雅。适合副标题、句子。',
    text: 'line',
    params: {
      ...TYPE,
      effect: sel('动势', ['blur', 'zoom', 'tilt', 'focus', 'drift']),
      animateBy: sel('拆分', ['words', 'letters']),
      direction: sel('来向', ['top', 'bottom', 'left', 'right']),
      trigger: sel('触发', ['view', 'load', 'hover', 'click']),
      delay: num('逐个间隔 ms', 40, 600),
      blur: num('模糊强度', 0, 30),
      loop: bool('循环'),
    },
    defaults: {...TYPE_DEFAULTS, effect: 'blur', trigger: 'load', animateBy: 'words'},
  },
  {
    id: 'shiny-text',
    name: '流光文字',
    kind: 'text',
    description: '文字上有一道流光扫过。适合小标题、状态提示、"新"这类强调。克制好用。',
    text: 'line',
    params: {
      ...TYPE,
      shineColor: color('流光颜色'),
      speed: num('扫过周期 s', 0.5, 8),
      angle: num('倾斜角度', 0, 180),
      shineWidth: num('光带宽度', 10, 80),
      glow: num('辉光', 0, 1),
      trigger: sel('触发', ['loop', 'hover', 'view']),
      direction: sel('方向', ['left', 'right']),
    },
    defaults: {...TYPE_DEFAULTS, size: 20, font: 'sans', weight: 600, color: '#8a7f72', shineColor: '#e5372e', speed: 3},
  },
  {
    id: 'gradient-text',
    name: '渐变文字',
    kind: 'text',
    description: '流动的渐变色文字，可带描边框。适合做醒目的品牌词、大标题。',
    text: 'line',
    params: {
      ...TYPE,
      colors: colors('渐变色（2-6 个）', 6),
      animationSpeed: num('流速 s', 2, 30),
      variant: sel('渐变形态', ['linear', 'flow', 'conic']),
      angle: num('角度', 0, 360),
      yoyo: bool('来回流动'),
      glow: num('辉光', 0, 1),
      showBorder: bool('带边框'),
    },
    defaults: {...TYPE_DEFAULTS, colors: ['#e5372e', '#ff9a3d', '#7c5cff', '#e5372e'], animationSpeed: 8},
  },
  {
    id: 'decrypted-text',
    name: '解码文字',
    kind: 'text',
    description: '文字像被解密一样从乱码里还原，有黑客/终端感。适合标签、代号、小标题。',
    text: 'line',
    params: {
      ...TYPE,
      effect: sel('效果', ['scramble', 'flip', 'fade']),
      animateOn: sel('触发', ['view', 'hover', 'inViewHover', 'click']),
      revealDirection: sel('还原方向', ['start', 'end', 'center', 'random']),
      speed: num('乱码速度 ms', 10, 200),
      maxIterations: num('乱码次数', 2, 30),
      sequential: bool('逐字还原'),
      scrambleColor: color('乱码颜色'),
      loop: bool('循环'),
    },
    defaults: {...TYPE_DEFAULTS, size: 22, font: 'mono', weight: 500, animateOn: 'view', sequential: true, revealDirection: 'start'},
  },
  {
    id: 'text-type',
    name: '打字机',
    kind: 'text',
    description: '逐字打出再删掉，循环多句。text 每行是一句话。适合问候语、口号轮播。',
    text: 'lines',
    params: {
      ...TYPE,
      prefix: str('固定前缀', 40),
      typingSpeed: num('打字速度 ms', 15, 200),
      deletingSpeed: num('删除速度 ms', 10, 150),
      pauseDuration: num('停顿 ms', 300, 6000),
      loop: bool('循环'),
      showCursor: bool('显示光标'),
      cursorStyle: sel('光标样式', ['character', 'bar', 'block', 'underscore']),
      typeEffect: sel('出字效果', ['none', 'fade', 'blur', 'rise']),
      textColors: colors('每句颜色', 6),
    },
    defaults: {...TYPE_DEFAULTS, size: 36, loop: true, cursorStyle: 'bar', pauseDuration: 1800},
  },
  {
    id: 'rotating-text',
    name: '轮播词',
    kind: 'text',
    description: '一个词不断翻转成下一个词，可加高亮色块。text 每行一个词。适合"我在做 ___"这类句式的变化部分。',
    text: 'lines',
    params: {
      ...TYPE,
      effect: sel('切换效果', ['slide', 'flip', 'blur', 'scale', 'drop']),
      direction: sel('方向', ['up', 'down']),
      rotationInterval: num('切换间隔 ms', 800, 8000),
      staggerDuration: num('逐字错开 s', 0, 0.2),
      highlight: bool('高亮色块'),
      highlightColor: color('高亮色'),
      splitBy: sel('拆分', ['characters', 'words', 'lines']),
    },
    defaults: {...TYPE_DEFAULTS, rotationInterval: 2200, effect: 'slide'},
  },
  {
    id: 'count-up',
    name: '数字滚动',
    kind: 'text',
    description: '数字从 0 滚到目标值。text 填一个数字。适合 KPI、天数统计、"已连续 128 天"。',
    text: 'number',
    params: {
      ...TYPE,
      from: num('起始值', -1e9, 1e9),
      prefix: str('前缀', 12),
      suffix: str('后缀', 12),
      duration: num('时长 s', 0.5, 8),
      separator: str('千分位符号', 2),
      decimals: num('小数位', 0, 4),
      mode: sel('形式', ['count', 'roll']),
      format: sel('格式', ['standard', 'compact']),
      trigger: sel('触发', ['view', 'load']),
    },
    defaults: {...TYPE_DEFAULTS, size: 96, weight: 700, separator: ',', trigger: 'load', duration: 2},
  },
  {
    id: 'fuzzy-text',
    name: '毛边故障字',
    kind: 'text',
    description: '文字边缘像显像管一样抖动模糊，悬停加剧，可开启随机故障。适合做 404 / 标题冲击感。',
    text: 'line',
    params: {
      ...TYPE,
      baseIntensity: num('常态抖动', 0, 1),
      hoverIntensity: num('悬停抖动', 0, 1.5),
      fuzzRange: num('毛边宽度', 5, 80),
      glitchMode: bool('随机故障'),
      direction: sel('抖动方向', ['horizontal', 'vertical', 'both']),
      colorSplit: num('色差', 0, 12),
      trigger: sel('触发', ['hover', 'always', 'click']),
      gradient: colors('渐变色', 4),
    },
    defaults: {...TYPE_DEFAULTS, size: 96, weight: 900, font: 'sans', trigger: 'hover', baseIntensity: 0.15},
  },
  {
    id: 'scroll-velocity',
    name: '滚动字幕',
    kind: 'text',
    description: '一条无限横向滚动的大字字幕，像杂志封面的跑马灯。text 每行一句，会交替方向循环。适合分隔带、口号。',
    text: 'lines',
    params: {
      ...TYPE,
      velocity: num('滚动速度', 10, 400),
      gap: num('词间距 px', 0, 200),
      pauseOnHover: bool('悬停暂停'),
      fadeEdges: bool('两端渐隐'),
      outlineAlternate: bool('隔词描边'),
      draggable: bool('可拖动'),
      separator: str('分隔符', 6),
    },
    defaults: {...TYPE_DEFAULTS, size: 72, weight: 800, velocity: 80, gap: 40, fadeEdges: true, separator: '✦'},
  },

  // ───────────── 卡片 ─────────────
  {
    id: 'spotlight-card',
    name: '聚光卡片',
    kind: 'card',
    description: '带跟随鼠标的聚光灯和边缘辉光的卡片。text 第一行是标题，其余行是正文。适合重点提示、功能说明。',
    text: 'body',
    params: {
      ...TYPE,
      spotlightColor: color('光斑颜色'),
      intensity: num('光强', 0.02, 0.6),
      spotlightSize: num('光斑大小 px', 80, 700),
      softness: num('柔和度', 0, 1),
      shape: sel('形状', ['circle', 'beam']),
      borderGlow: num('边缘辉光', 0, 1),
      ambient: bool('常亮微光'),
      flare: bool('耀斑'),
      grain: num('颗粒', 0, 1),
    },
    defaults: {size: 22, weight: 600, font: 'serif', align: 'left', spotlightColor: '#e5372e', intensity: 0.18},
  },
  {
    id: 'glare-hover',
    name: '扫光卡片',
    kind: 'card',
    description: '悬停时一道高光划过的卡片，可持续循环扫光。text 第一行是标题，其余行是正文。适合展示型卡片。',
    text: 'body',
    params: {
      ...TYPE,
      background: color('卡片底色'),
      borderColor: color('边框色'),
      glareColor: color('扫光颜色'),
      glareOpacity: num('扫光强度', 0.05, 1),
      glareAngle: num('扫光角度', -90, 90),
      glareSize: num('光带宽度', 10, 80),
      variant: sel('形态', ['streak', 'twin', 'sheen']),
      mode: sel('触发', ['hover', 'follow', 'loop', 'click']),
      rimGlint: bool('边缘闪光'),
    },
    defaults: {size: 22, weight: 600, font: 'serif', align: 'left', background: '#1b1714', glareColor: '#ffffff', mode: 'loop', color: '#f4efe6'},
  },

  // ───────────── 整页叠加层 ─────────────
  {
    id: 'noise',
    name: '胶片颗粒',
    kind: 'overlay',
    description: '盖在整页上的细腻颗粒，给纸张/胶片的质感。只能作页面图层。纸张主题下很加分。',
    text: 'none',
    params: {
      opacity: num('强度', 0.02, 0.6),
      size: num('颗粒大小', 0.5, 4),
      fps: num('帧率', 0, 30),
      blendMode: sel('混合', ['normal', 'overlay', 'soft-light', 'multiply', 'screen', 'difference']),
      contrast: num('对比度', 0, 1),
      colored: bool('彩色颗粒'),
      dust: num('灰尘', 0, 1),
      scratches: num('划痕', 0, 1),
      scanlines: num('扫描线', 0, 1),
      flicker: num('闪烁', 0, 1),
    },
    defaults: {opacity: 0.05, blendMode: 'multiply', fps: 8, size: 1, contrast: 0.5},
  },
  {
    id: 'click-spark',
    name: '点击火花',
    kind: 'overlay',
    description: '页面上任何一次点击都迸出一圈小火花。只能作页面图层。小而愉悦。',
    text: 'none',
    params: {
      sparkColor: colors('火花颜色', 4),
      shape: sel('形状', ['line', 'streak', 'dot', 'star']),
      sparkCount: num('数量', 3, 20),
      sparkSize: num('火花长度', 4, 40),
      sparkRadius: num('扩散半径', 10, 100),
      sparkWidth: num('线宽', 1, 6),
      duration: num('时长 ms', 150, 1400),
      ring: bool('带圆环'),
      glow: num('辉光', 0, 1),
      gravity: num('重力', -1, 1),
    },
    defaults: {sparkColor: ['#e5372e'], shape: 'line', sparkCount: 9, sparkSize: 16, sparkRadius: 34, duration: 550},
  },

  // ───────────── 3D ─────────────
  {
    id: 'spline',
    name: 'Spline 3D 场景',
    kind: 'scene',
    description:
      '嵌入一个 Spline 3D 场景（可旋转、可交互的 3D）。scene 必须是 https://prod.spline.design/<id>/scene.splinecode 形式的公开导出地址。示例：https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode。用户可以在 spline.design 里设计并「Export → Code → Viewer」拿到地址。可作横幅块，也可作整页背景图层。',
    text: 'none',
    params: {
      scene: str('.splinecode 地址', 300),
    },
    defaults: {},
  },
]

/** 背景与 3D 作为「横幅块」时，可以在上面叠一行文字；这两个参数由外层处理，不传给组件。 */
export const BANNER_KEYS = ['textColor', 'textSize'] as const
for (const def of FX_DEFS) {
  if (def.kind === 'background' || def.kind === 'scene') {
    def.params = {
      ...def.params,
      textColor: color('横幅文字颜色（作横幅块并填了 text 时）'),
      textSize: num('横幅文字字号 px', 14, 160),
    }
  }
}

const BY_ID = new Map(FX_DEFS.map((def) => [def.id, def]))

export function getFx(id: string): FxDef | undefined {
  return BY_ID.get(id)
}

/** Spline 只允许官方托管域，防止被诱导加载任意站点的脚本化资源。 */
const SPLINE_URL = /^https:\/\/(prod|my)\.spline\.design\/[A-Za-z0-9_\-/]+\.splinecode$/

export function isSplineUrl(value: string): boolean {
  return SPLINE_URL.test(value.trim())
}

/**
 * 规整一份参数：丢弃未知键、钳制数值、校验颜色；再叠在默认值之上。
 * 返回的永远是可直接交给渲染器的安全对象。
 */
export function normalizeParams(def: FxDef, raw: unknown): Record<string, unknown> {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const result: Record<string, unknown> = {...def.defaults}
  for (const [key, spec] of Object.entries(def.params)) {
    if (!(key in source)) continue
    const value = source[key]
    switch (spec.t) {
      case 'color': case 'colors': {
        const clean = normalizeColor(spec, value)
        if (clean !== undefined) result[key] = clean
        break
      }
      case 'number':
        if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.min(spec.max, Math.max(spec.min, value))
        break
      case 'bool':
        if (typeof value === 'boolean') result[key] = value
        break
      case 'select':
        if (typeof value === 'string' && spec.options.includes(value)) result[key] = value
        break
      case 'string':
        if (typeof value === 'string') result[key] = value.slice(0, spec.max)
        break
    }
  }
  if (source.palette === 'theme') result.palette = 'theme'
  for (const mode of ['light', 'dark'] as const) {
    const branch = source[mode]
    if (!branch || typeof branch !== 'object' || Array.isArray(branch)) continue
    const clean: Record<string, unknown> = {}
    for (const [key, spec] of Object.entries(def.params)) {
      if (spec.t !== 'color' && spec.t !== 'colors') continue
      const value = normalizeColor(spec, (branch as Record<string, unknown>)[key])
      if (value !== undefined) clean[key] = value
    }
    // 空或全非法分支不改变旧配色；分支内不注入默认色，也不接受嵌套控制字段。
    if (Object.keys(clean).length) result[mode] = clean
  }
  if (def.id === 'spline') {
    const scene = typeof result.scene === 'string' ? result.scene.trim() : ''
    if (scene && !isSplineUrl(scene)) delete result.scene
    else if (scene) result.scene = scene
  }
  return result
}

function normalizeColor(spec: Extract<FxParam, {t: 'color' | 'colors'}>, value: unknown): string | string[] | undefined {
  if (spec.t === 'color') return typeof value === 'string' && (isColor(value) || value === 'transparent') ? value.trim() : undefined
  if (!Array.isArray(value)) return undefined
  const colors = value.filter((item): item is string => typeof item === 'string' && isColor(item)).slice(0, spec.max)
  return colors.length ? colors : undefined
}

/** 页面图层：背景类 / 3D / 叠加层可用，文字和卡片不行。 */
export function isLayerFx(def: FxDef): boolean {
  return def.kind === 'background' || def.kind === 'overlay' || def.kind === 'scene'
}

/** 内容块：叠加层不行。 */
export function isBlockFx(def: FxDef): boolean {
  return def.kind !== 'overlay'
}

export class FxError extends WorkspaceError {}

/** 规整并校验一层页面图层。 */
export function normalizeLayer(raw: unknown): {effect: string; params: Record<string, unknown>} {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const id = typeof source.effect === 'string' ? source.effect : ''
  const def = getFx(id)
  if (!def) throw new FxError(`没有这个效果：${id || '（空）'}。可用：${FX_DEFS.filter(isLayerFx).map((d) => d.id).join('、')}`)
  if (!isLayerFx(def)) throw new FxError(`「${def.name}」是${def.kind === 'text' ? '文字' : '卡片'}类，只能作内容块，不能作页面图层。请用 add_component(type:"fx")。`)
  const params = normalizeParams(def, source.params)
  if (def.id === 'spline' && !params.scene) throw new FxError('Spline 需要合法的 scene 地址：https://prod.spline.design/<id>/scene.splinecode')
  return {effect: def.id, params}
}

/** 给 AI 的目录：精简成它能直接读懂的结构。 */
export function describeFx(def: FxDef) {
  const colorFields = Object.entries(def.params).filter(([, spec]) => spec.t === 'color' || spec.t === 'colors').map(([key]) => key)
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    use: isLayerFx(def) && isBlockFx(def) ? ['layer', 'block'] : isLayerFx(def) ? ['layer'] : ['block'],
    description: def.description,
    text: def.text,
    theme: {
      colorFields,
      precedence: ['params', 'palette', 'currentMode'],
      palette: 'params.palette:"theme" 使用宿主语义色；未声明时保留原有固定配色与适配行为。',
      modes: 'params.light / params.dark 只接受上列颜色字段，分别覆盖当前模式；不接受动画、布局、scene或嵌套控制字段。未提供分支继承普通参数与语义色板。更新组件时每个分支整体替换，null清除该分支；palette:null关闭语义色板。',
      limitation: def.id === 'noise' ? '颗粒没有可配置颜色，色板不会改变颗粒。' : def.kind === 'scene' ? '仅宿主横幅文字接受配色；远程Spline场景颜色不由宿主控制。' : '显式配色仍需检查明暗对比度，宿主不会自动修正用户指定颜色。',
    },
    policy: {
      ...getFxCapability(def.id),
      pageLimits: {desktop: FX_BUDGET_LIMITS, compact: FX_COMPACT_LIMITS},
      compactWidth: FX_COMPACT_WIDTH,
      accounting: '图层与特效块共同计量；点数是产品规则，不是性能测量。持续动画数按 loop、trigger、ambient 等实际参数判断。',
      compatibility: '旧配置保留；超预算按图层优先、内容块其次静态显示。减少动画、离屏和隐藏由宿主统一处理。',
    },
    params: {...Object.fromEntries(
      Object.entries(def.params).map(([key, spec]) => {
        const hint =
          spec.t === 'number'
            ? `number ${spec.min}~${spec.max}`
            : spec.t === 'select'
              ? `one of ${spec.options.join('|')}`
              : spec.t === 'colors'
                ? `color[] ≤${spec.max}`
                : spec.t === 'string'
                  ? `string ≤${spec.max}`
                  : spec.t
        return [key, `${spec.label}（${hint}）`]
      }),
    ), palette: '语义色板（可选 "theme"）', light: `浅色颜色补丁（仅 ${colorFields.join('、') || '无可配置颜色'}）`, dark: `深色颜色补丁（仅 ${colorFields.join('、') || '无可配置颜色'}）`},
    defaults: def.defaults,
  }
}
