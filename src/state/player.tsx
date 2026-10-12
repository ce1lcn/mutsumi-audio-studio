import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { studio } from '../api'

interface PlayerValue {
  path: string
  playing: boolean
  currentTime: number
  duration: number
  error: string
  toggle(path: string): void
  seek(seconds: number): void
  stop(): void
}

const PlayerContext = createContext<PlayerValue | null>(null)

export function usePlayer(): PlayerValue {
  const value = useContext(PlayerContext)
  if (!value) throw new Error('usePlayer 必须在 PlayerProvider 内使用')
  return value
}

/** 全局唯一的试听播放器，切换文件时自动停止上一个 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [path, setPath] = useState('')
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = new Audio()
    element.preload = 'metadata'
    element.addEventListener('play', () => setPlaying(true))
    element.addEventListener('pause', () => setPlaying(false))
    element.addEventListener('ended', () => setPlaying(false))
    element.addEventListener('timeupdate', () => setCurrentTime(element.currentTime))
    element.addEventListener('loadedmetadata', () => setDuration(Number.isFinite(element.duration) ? element.duration : 0))
    element.addEventListener('error', () => { setPlaying(false); setError('无法播放该文件（可能已被移动或格式不受支持）') })
    audio.current = element
    return () => { element.pause(); element.src = '' }
  }, [])

  const toggle = useCallback((next: string) => {
    const element = audio.current
    if (!element) return
    if (next === path) {
      if (element.paused) void element.play().catch(() => undefined)
      else element.pause()
      return
    }
    setError('')
    setCurrentTime(0)
    setDuration(0)
    setPath(next)
    element.src = studio.media.url(next)
    void element.play().catch(() => undefined)
  }, [path])

  const seek = useCallback((seconds: number) => {
    if (audio.current) audio.current.currentTime = seconds
  }, [])

  const stop = useCallback(() => {
    const element = audio.current
    if (!element) return
    element.pause()
    element.removeAttribute('src')
    element.load()
    setPath('')
    setPlaying(false)
  }, [])

  const value = useMemo(() => ({ path, playing, currentTime, duration, error, toggle, seek, stop }), [path, playing, currentTime, duration, error, toggle, seek, stop])
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}
