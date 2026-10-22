import {useStored} from './store'

/**
 * 对话记录。
 *
 * 一轮对话是一个 Turn：用户说了什么，模型想了什么、答了什么，
 * 中间调用了哪些工具、各自成没成，用时多久。
 *
 * 这样存的原因：界面要能折叠思考过程、按轮展示工具调用、
 * 显示耗时和失败原因，而不是把所有东西拍平成一行行文字。
 */

/** 一次工具调用。 */
export type ToolStep = {
  name: string
  /** 给用户看的动作说明，例如「添加组件：待办」 */
  title: string
  ok: boolean
  /** 执行结果或失败原因，展开时显示 */
  text: string
}

/** 等待用户答复的确认请求。 */
export type PendingApproval = {
  request: {tool: string; summary: string}
}

export type Turn = {
  id: string
  /** 用户输入；工具紧随其后时为 undefined 不算，这里始终有值 */
  prompt: string
  /** 模型正文，流式增长 */
  answer: string
  /** 模型的思考过程（部分模型会返回） */
  reasoning: string
  tools: ToolStep[]
  /** 失败信息；成功时为空串 */
  error: string
  /** 本轮开始/结束时间，用来算耗时 */
  startedAt: number
  endedAt?: number
  /** 是否被用户中止 */
  aborted?: boolean
  /** 非空表示这一轮正卡在某个确认上，界面据此显示确认卡片 */
  pending?: PendingApproval
}

/** 旧版扁平记录：只用于一次性丢弃，不做迁移。 */
type LegacyTurn = {kind: string}

const KEY = 'chatTurns.v2'

export function useTurns() {
  return useStored<Turn[]>(KEY, [] as Turn[])
}

/** 起一轮新对话。 */
export function beginTurn(prompt: string): Turn {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    prompt,
    answer: '',
    reasoning: '',
    tools: [],
    error: '',
    startedAt: Date.now(),
  }
}

/** 一轮是否还在进行中（用于界面显示「思考中」）。 */
export function isActive(turn: Turn): boolean {
  return turn.endedAt === undefined
}

/** 耗时（毫秒）；未结束返回 undefined。 */
export function elapsed(turn: Turn): number | undefined {
  return turn.endedAt === undefined ? undefined : turn.endedAt - turn.startedAt
}

export type {LegacyTurn}
