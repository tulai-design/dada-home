import Avatar from 'boring-avatars'

// 头像是按持久化 seed 生成的插画；固定色板保证切换明暗时仍是同一张脸。
const AVATAR_COLORS = ['#f5c346', '#f17d6c', '#68c4b0', '#7596d2', '#b69bd5']

export function ProfileAvatar({seed, size = '100%'}: {seed: string; size?: number | string}) {
  return <Avatar name={seed} variant="beam" size={size} colors={AVATAR_COLORS} aria-hidden="true" focusable="false" />
}
