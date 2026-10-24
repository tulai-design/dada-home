import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, BarChart3, BookOpen, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Clock, Cloud, Code, Coins, Copy, Dices, Download, Eye, EyeOff, Filter, Flag, Flame, Globe, Grid3x3, Hash, Heart, HelpCircle, Home, Image, Info,
  Key, Link, List, Lock, LockOpen, Mail, MapPin, MessageCircle, Minus, Moon, Music, Pause, Pencil, Play, Plus, RefreshCw, Repeat, Search, Settings, Shield,
  Shuffle, SkipBack, SkipForward, Sparkles, Square, Star, Sun, Target, Terminal, Timer, Trash2, TrendingDown, TrendingUp, Trophy, Type, Upload,
  User, Volume2, Wallet, Wand2, X, Zap, Calendar,
} from 'lucide-react'
import type {LucideIcon} from 'lucide-react'
import type {IconName} from './catalog'

const MAP: Record<IconName, LucideIcon> = {
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

export const iconOf = (name: unknown): LucideIcon | undefined => (typeof name === 'string' ? MAP[name as IconName] : undefined)
