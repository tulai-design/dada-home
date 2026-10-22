/** 直接用 Unsplash 图床，不需要 Access Key。换一张只是换池子里的下一张。 */
export type WallpaperMode = 'unsplash' | 'custom' | 'off'

const PHOTOS = [
  '1506744038136-46273834b3fb',
  '1469474968028-56623f02e42e',
  '1441974231531-c6227db76b6e',
  '1470071459604-3b5ec3a7fe05',
  '1500530855697-b586d89ba3ee',
  '1519681393784-d120267933ba',
  '1472214103451-9374bd1c798e',
  '1439066615861-d1af74d74000',
  '1464822759023-fed622ff2c3b',
  '1426604966848-d7adac402bff',
]

export function unsplashUrl(index: number, width = 2000): string {
  const id = PHOTOS[((index % PHOTOS.length) + PHOTOS.length) % PHOTOS.length]
  return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${width}&q=80`
}

export function wallpaperUrl(mode: WallpaperMode, index: number, custom: string): string {
  if (mode === 'off') return ''
  if (mode === 'custom') return custom.trim()
  return unsplashUrl(index)
}
