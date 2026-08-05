import { ChevronLeft, ChevronRight, Menu, Moon, Redo2, Sun, Undo2 } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import type { SchedulerView } from './scheduler'
import './Header.css'
import '../index.css'

const VIEWS: SchedulerView[] = ['day', 'week', 'month']

export interface HeaderProps {
  drawerOpen: boolean
  onToggleDrawer: () => void
  title: string
  onToday: () => void
  onPrev: () => void
  onNext: () => void
  view: SchedulerView
  onViewChange: (view: SchedulerView) => void
  canUndo: boolean
  onUndo: () => void
  canRedo: boolean
  onRedo: () => void
}

export default function Header({
  drawerOpen,
  onToggleDrawer,
  title,
  onToday,
  onPrev,
  onNext,
  view,
  onViewChange,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
}: HeaderProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <header className="app-header theme-transition">
      <div className="app-header-left">
        <button
          type="button"
          className={`app-header-icon-btn app-header-ghost${drawerOpen ? ' app-header-ghost-active' : ''}`}
          onClick={onToggleDrawer}
          aria-pressed={drawerOpen}
          aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
        >
          <Menu size={19} />
        </button>
        <img
          className="app-header-logo"
          // Named by the mark's own color, not which theme to use it in —
          // the navy "-dark" mark is for light backgrounds, the white
          // "-light" mark is for dark backgrounds.
          src={theme === 'light' ? '/calendae-logo-1-dark.svg' : '/calendae-logo-1-light.svg'}
          alt=""
        />
        <span className="app-header-brand">Calendae</span>
      </div>

      <div className="app-header-nav">
        <button type="button" className="app-header-btn app-header-ghost" onClick={onToday}>
          Today
        </button>
        <button
          type="button"
          className="app-header-icon-btn app-header-ghost"
          onClick={onPrev}
          aria-label="Previous"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          className="app-header-icon-btn app-header-ghost"
          onClick={onNext}
          aria-label="Next"
        >
          <ChevronRight size={18} />
        </button>
        <span className="app-header-title">{title}</span>
      </div>

      <div className="app-header-right">
        <div className="app-header-views">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              className={`app-header-view-btn${v === view ? ' app-header-view-btn-active' : ''}`}
              onClick={() => onViewChange(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="app-header-icon-btn app-header-ghost"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo (Ctrl/Cmd+Z)"
        >
          <Undo2 size={18} />
        </button>
        <button
          type="button"
          className="app-header-icon-btn app-header-ghost"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo"
          title="Redo (Ctrl/Cmd+Shift+Z)"
        >
          <Redo2 size={18} />
        </button>
        <button
          type="button"
          className="app-header-icon-btn app-header-ghost"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </div>
    </header>
  )
}
