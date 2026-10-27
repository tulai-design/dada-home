/** 本地实现的能力与宿主约束。独立于 catalog，供写入、渲染和 AI 共享。 */
export type FxRenderer = 'dom' | 'svg' | 'canvas' | 'webgl' | 'external'
export type FxMotion = 'continuous' | 'once' | 'interaction'

export type FxQuality = {
  max?: Record<string, number>
  min?: Record<string, number>
  compactMax?: Record<string, number>
  /** 这些是 vendor 的真实 prop；不能作为持久化参数绕过 catalog。 */
  resolution?: 'dpr' | 'pixelRatio' | 'resolution' | 'maxDevicePixelRatio'
  maxEffectiveDpr?: number
  note?: string
}

export type FxCapability = {
  renderer: FxRenderer
  /** 产品预算点数，并非实测帧率或耗电。 */
  cost: number
  motion: FxMotion
  containers: Array<'layer' | 'block'>
  compact: 'static' | 'bounded'
  touch: string
  reducedMotion: 'static'
  lifecycle: 'unmount-when-hidden-or-offscreen'
  quality: FxQuality
  implementationNote: string
  source: {
    kind: 'local-adaptation' | 'package'
    location: string
    introducedCommit: string
    upstreamRevision: string | null
    license: 'needs-verification'
    note: string
  }
}

type CapabilityInput = Pick<FxCapability, 'renderer' | 'motion' | 'containers' | 'implementationNote'> & {
  file: string
  quality?: FxQuality
  touch?: string
  compact?: FxCapability['compact']
}

const COST: Record<FxRenderer, number> = {dom: 1, svg: 1, canvas: 2, webgl: 3, external: 6}
const touch = '粗指针或窄容器关闭指针跟随装饰；悬停触发文字改为入场，核心内容保持可读。'

function local(input: CapabilityInput): FxCapability {
  return {
    renderer: input.renderer,
    cost: COST[input.renderer],
    motion: input.motion,
    containers: input.containers,
    compact: input.compact ?? (input.renderer === 'webgl' ? 'static' : 'bounded'),
    touch: input.touch ?? touch,
    reducedMotion: 'static',
    lifecycle: 'unmount-when-hidden-or-offscreen',
    quality: {...input.quality, ...(input.quality?.resolution ? {maxEffectiveDpr: 1.5} : {})},
    implementationNote: input.implementationNote,
    source: {
      kind: 'local-adaptation', location: `src/fx/vendor/${input.file}.tsx`, introducedCommit: '4412c03',
      upstreamRevision: null, license: 'needs-verification',
      note: '历史目录标记为 React Bits 改编；本地副本缺少对应上游 revision 与许可凭据，待核对，不能套用上游当前条款。',
    },
  }
}

const background = (file: string, implementationNote: string, quality: FxQuality, motion: FxMotion = 'continuous') =>
  local({file, renderer: 'webgl', motion, containers: ['layer', 'block'], implementationNote, quality})
const text = (file: string, motion: FxMotion, implementationNote: string) =>
  local({file, renderer: 'dom', motion, containers: ['block'], implementationNote})

const CAPABILITIES: Record<string, FxCapability> = {
  aurora: background('Aurora', '有 paused、离屏与隐藏暂停；原生 reduce 仅冻结时钟，仍会 RAF。', {resolution: 'dpr', max: {layers: 2}}),
  silk: background('Silk', '有 paused、离屏与隐藏暂停；静止并收敛后停止 RAF。', {resolution: 'dpr'}),
  beams: background('Beams', '有 paused、离屏与隐藏暂停；quality 控制中间渲染场分辨率。', {resolution: 'dpr', max: {quality: 0.65}}),
  galaxy: background('Galaxy', '暂停 prop 为 disableAnimation；离屏与隐藏暂停，收敛后停止 RAF。', {resolution: 'dpr', max: {layers: 3, density: 1.5}}),
  iridescence: background('Iridescence', '有 paused 与离屏暂停；未自行监听 document visibility。', {resolution: 'resolution'}),
  'liquid-chrome': background('LiquidChrome', '无暂停 prop；原生 reduce 仍以四分之一速度流动；内部另有 240 万像素上限。', {resolution: 'maxDevicePixelRatio', max: {detail: 4}}),
  orb: background('Orb', '有 paused、离屏与隐藏暂停；触摸抬起重置指针状态。', {resolution: 'dpr'}),
  particles: background('Particles', '有 paused、离屏与隐藏暂停；真实分辨率 prop 为 pixelRatio。', {resolution: 'pixelRatio', max: {particleCount: 300}, compactMax: {particleCount: 120}}),
  threads: background('Threads', '有 paused、离屏与隐藏暂停；没有外部 DPR prop。', {max: {lineCount: 40}, note: '内部 DPR≤2，渲染最长边≤1920；宿主只能限制线数。'}),
  waves: background('Waves', '波纹线也是 WebGL2；有 paused、离屏与隐藏暂停。', {resolution: 'dpr', min: {spacing: 14}}),
  'dot-grid': background('DotGrid', '点阵也是 WebGL2；入场与交互收敛后停止 RAF，仍占 GL 上下文。', {resolution: 'dpr', min: {gap: 20}}, 'interaction'),
  'split-text': text('SplitText', 'once', 'DOM 与 GSAP；支持 trigger/loop；原生 reduce 显示完整文字。'),
  'blur-text': text('BlurText', 'once', 'DOM 与 MotionConfig；无保证 loop 和模糊动画停止的独立静态策略。'),
  'shiny-text': text('ShinyText', 'continuous', 'DOM 流光；有 disabled 和离屏观察；canvas 仅用于颜色探测。'),
  'gradient-text': text('GradientText', 'continuous', 'DOM 渐变；reduce 或暂停后收敛停止；有离屏观察。'),
  'decrypted-text': text('DecryptedText', 'once', 'DOM 解码；支持 loop；原有 hover 使用鼠标事件，触屏改入场。'),
  'text-type': text('TextType', 'continuous', '监听 reduce 变化，但原实现仍会删/换句；宿主保留全部静态文字。'),
  'rotating-text': text('RotatingText', 'continuous', 'MotionConfig 只简化转场；auto 定时轮换仍运行，无原生离屏暂停。'),
  'count-up': text('CountUp', 'once', 'DOM 数字与辅助 SVG 滤镜；reduce 显示目标值。'),
  'fuzzy-text': local({file: 'FuzzyText', renderer: 'canvas', motion: 'continuous', containers: ['block'],
    implementationNote: '默认 baseIntensity>0，即使 trigger=hover 也持续抖动；有离屏观察与 reduce 分支。',
    quality: {max: {fps: 30}, compactMax: {fps: 20}, note: '内部 DPR≤2，无外部 DPR prop。'}}),
  'scroll-velocity': text('ScrollVelocity', 'continuous', 'DOM 跑马灯；reduce 时动画回调直接返回，但原实现无离屏暂停。'),
  'spotlight-card': local({file: 'SpotlightCard', renderer: 'dom', motion: 'interaction', containers: ['block'], compact: 'static', implementationNote: 'ambient=true 会持续动画；原实现触摸抬起复位，有离屏观察。', touch: '粗指针或窄容器使用静态卡片正文，关闭光效。'}),
  'glare-hover': local({file: 'GlareHover', renderer: 'dom', motion: 'continuous', containers: ['block'], compact: 'static', implementationNote: '目录默认 mode=loop；hover/follow/click 是交互形式；支持键盘 focus。', touch: '粗指针或窄容器使用静态卡片正文，关闭光效。'}),
  noise: local({file: 'Noise', renderer: 'canvas', motion: 'continuous', containers: ['layer'], implementationNote: 'Canvas2D 与 CSS 颗粒；fps=0 静态，reduce 停止，离屏暂停；无原生 visibility 监听。', quality: {max: {fps: 20}, compactMax: {fps: 12}, note: '内部 DPR≤2，无外部 DPR prop。'}, touch: '无悬停依赖。'}),
  'click-spark': local({file: 'ClickSpark', renderer: 'canvas', motion: 'interaction', containers: ['layer'], implementationNote: '原实现支持触摸点击与键盘 click，仅有火花时运行 RAF；业务子树与火花引擎分离。', quality: {max: {sparkCount: 12}, compactMax: {sparkCount: 8}, note: '内部 DPR≤2；减少动画时由宿主禁用引擎。'}, touch: '宿主在粗指针设备禁用火花引擎，保留页面业务子树。'}),
  spline: {
    renderer: 'external', cost: 6, motion: 'continuous', containers: ['layer', 'block'], compact: 'static',
    touch: '场景交互能力不确定；小容器静态替代，不把场景内交互作为唯一入口。',
    reducedMotion: 'static', lifecycle: 'unmount-when-hidden-or-offscreen', quality: {note: '当前适配器没有场景质量或暂停接口，资源开销由场景决定。'},
    implementationNote: '通过 @splinetool/react-spline 加载公开场景；按持续 GPU 使用保守计量。',
    source: {kind: 'package', location: '@splinetool/react-spline / @splinetool/runtime', introducedCommit: '4412c03', upstreamRevision: null, license: 'needs-verification', note: '依赖版本以 pnpm-lock.yaml 为准；运行库条款与远程场景的授权分别核对。'},
  },
}

export function getFxCapability(id: string): FxCapability | undefined {
  return Object.hasOwn(CAPABILITIES, id) ? CAPABILITIES[id] : undefined
}

const POINTER_OVERRIDES: Record<string, Record<string, unknown>> = {
  aurora: {mouseInteraction: false}, silk: {mouseInteraction: false, clickRipple: false}, beams: {mouseInteraction: false},
  galaxy: {mouseInteraction: false, mouseRepulsion: false, clickWarp: false}, iridescence: {mouseReact: false, clickSwirl: false},
  'liquid-chrome': {interactive: false}, orb: {followCursor: false, rotateOnHover: false, clickPulse: false, hoverIntensity: 0},
  particles: {moveParticlesOnHover: false, clickBurst: false, connections: false}, threads: {enableMouseInteraction: false, parting: 0},
  waves: {mouseInteraction: false, clickRipple: false}, 'dot-grid': {mouseInteraction: false, clickShock: false},
  'split-text': {hoverEffect: 'none'}, 'blur-text': {focusOnHover: false}, 'shiny-text': {followPointer: false},
  'gradient-text': {followPointer: false, pauseOnHover: false}, 'fuzzy-text': {enableHover: false, clickEffect: false},
  'scroll-velocity': {draggable: false, pauseOnHover: false}, 'rotating-text': {pauseOnHover: false},
  'spotlight-card': {intensity: 0, borderGlow: 0, flare: false, ambient: false},
}

// 省略参数时，只有这两个 vendor 默认值小于宿主上限；不要因钳制而提高画质。
const BELOW_LIMIT_DEFAULTS: Record<string, Record<string, number>> = {aurora: {layers: 1}, galaxy: {density: 1}}

/** 输入先经 normalizeParams；返回运行时副本，额外 props 不写回保存配置。 */
export function qualityParams(id: string, params: Record<string, unknown>, context: {compact: boolean; coarsePointer: boolean}): Record<string, unknown> {
  const next = {...params}
  const capability = getFxCapability(id)
  if (!capability) return next
  const quality = capability.quality
  for (const [key, maximum] of Object.entries({...quality.max, ...(context.compact ? quality.compactMax : {})})) {
    const value = next[key]
    next[key] = typeof value === 'number' && Number.isFinite(value) ? Math.min(value, maximum) : BELOW_LIMIT_DEFAULTS[id]?.[key] ?? maximum
  }
  for (const [key, minimum] of Object.entries(quality.min ?? {})) {
    const value = next[key]
    next[key] = typeof value === 'number' && Number.isFinite(value) ? Math.max(value, minimum) : minimum
  }
  if (quality.resolution) {
    // Iridescence 的 resolution 是乘数，内部 DPR≤2，0.75 使有效 DPR≤1.5。
    const maximum = quality.resolution === 'resolution' ? (context.compact ? 0.5 : 0.75) : (context.compact ? 1 : 1.5)
    const value = next[quality.resolution]
    next[quality.resolution] = typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, maximum) : maximum
  }
  if (context.compact && id === 'particles') next.connections = false
  if (context.compact || context.coarsePointer) {
    Object.assign(next, POINTER_OVERRIDES[id])
    if (['split-text', 'blur-text', 'shiny-text'].includes(id) && next.trigger === 'hover') next.trigger = 'view'
    if (id === 'decrypted-text' && ['hover', 'inViewHover'].includes(String(next.animateOn))) next.animateOn = 'view'
    if (id === 'glare-hover' && ['hover', 'follow'].includes(String(next.mode))) next.mode = 'click'
  }
  return next
}
