import {Warning as AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, ChartBar as BarChart3, BookOpen, Bookmark, Check, CaretDown as ChevronDown, CaretLeft as ChevronLeft, CaretRight as ChevronRight, CaretUp as ChevronUp, Clock, Cloud, Code, Coins, Copy, DiceFive as Dices, DownloadSimple as Download, Eye, EyeSlash as EyeOff, Funnel as Filter, Flag, Fire as Flame, Globe, GridNine as Grid3x3, Hash, Heart, Question as HelpCircle, House as Home, Image, Info, Key, Link, List, Lock, LockSimpleOpen as LockOpen, Envelope as Mail, MapPin, ChatCircle as MessageCircle, Minus, Moon, MusicNotes as Music, Pause, PencilSimple as Pencil, Play, Plus, ArrowsClockwise as RefreshCw, Repeat, MagnifyingGlass as Search, Gear as Settings, ShieldCheck as Shield, Shuffle, SkipBack, SkipForward, Sparkle as Sparkles, Square, Star, Sun, Target, Terminal, Timer, Trash as Trash2, TrendDown as TrendingDown, TrendUp as TrendingUp, Trophy, TextT as Type, UploadSimple as Upload, User, SpeakerHigh as Volume2, Wallet, MagicWand as Wand2, X, Lightning as Zap, Calendar} from '@phosphor-icons/react'
import type {Icon as PhosphorIcon} from '@phosphor-icons/react'
import type {IconName} from './catalog'

const MAP: Record<IconName, PhosphorIcon> = {
  plus: Plus, minus: Minus, x: X, check: Check, trash: Trash2, edit: Pencil, copy: Copy, refresh: RefreshCw, search: Search, settings: Settings,
  star: Star, heart: Heart, bookmark: Bookmark, flag: Flag, play: Play, pause: Pause, stop: Square, 'skip-forward': SkipForward, 'skip-back': SkipBack,
  shuffle: Shuffle, repeat: Repeat, volume: Volume2, music: Music, timer: Timer, clock: Clock, calendar: Calendar, bell: Bell,
  'arrow-up': ArrowUp, 'arrow-down': ArrowDown, 'arrow-left': ArrowLeft, 'arrow-right': ArrowRight,
  'chevron-up': ChevronUp, 'chevron-down': ChevronDown, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight,
  link: Link, download: Download, upload: Upload, eye: Eye, 'eye-off': EyeOff, lock: Lock, unlock: LockOpen, key: Key, shield: Shield, user: User, home: Home,
  mail: Mail, message: MessageCircle, info: Info, alert: AlertTriangle, help: HelpCircle, sun: Sun, moon: Moon, cloud: Cloud, zap: Zap, flame: Flame,
  sparkles: Sparkles, wand: Wand2, dice: Dices, hash: Hash, type: Type, list: List, grid: Grid3x3, filter: Filter, wallet: Wallet, coins: Coins,
  chart: BarChart3, 'trending-up': TrendingUp, 'trending-down': TrendingDown, target: Target, trophy: Trophy, book: BookOpen, code: Code, terminal: Terminal,
  globe: Globe, 'map-pin': MapPin, image: Image,
}

export const iconOf = (name: unknown): PhosphorIcon | undefined => (typeof name === 'string' ? MAP[name as IconName] : undefined)
