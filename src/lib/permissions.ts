import {readStored, writeStored} from './store'

/**
 * 「总是允许」：用户在确认卡片上点过之后，同一种操作以后不再问。
 *
 * 只有这里列出的工具才有这个选项——它们都是「不改用户数据、只是帮用户打开一个页面」这类
 * 低风险动作；删除、覆盖这类高危操作永远要问。
 * 偏好只能由用户在界面里改，模型没有工具能碰它：模型不能给自己授权。
 */
export const REMEMBERABLE: Record<string, {label: string; hint: string}> = {
  open_search: {label: '搜索并跳转', hint: '让搭搭按你说的搜索引擎和关键词，直接在新标签页打开搜索结果'},
}

const KEY = 'alwaysAllow'

export const alwaysAllowed = (): string[] => readStored<string[]>(KEY, []).filter((name) => name in REMEMBERABLE)
export const isAlwaysAllowed = (name: string): boolean => alwaysAllowed().includes(name)

export function setAlwaysAllowed(name: string, on: boolean) {
  if (!(name in REMEMBERABLE)) return
  const rest = alwaysAllowed().filter((item) => item !== name)
  writeStored(KEY, on ? [...rest, name] : rest)
}
