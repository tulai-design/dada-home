export type ChatTurn =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; ok: boolean; text: string }
  | { kind: 'error'; text: string }
