/** TrajectoryToolbar — duration/turns/calls toggles + search. */

interface TrajectoryToolbarProps {
  readonly duration: boolean
  readonly onDurationChange: (value: boolean) => void
  readonly searchQuery: string
  readonly onSearchQueryChange: (value: string) => void
  readonly turnCount: number
  readonly callCount: number
}

export function TrajectoryToolbar({
  duration,
  onDurationChange,
  searchQuery,
  onSearchQueryChange,
  turnCount,
  callCount,
}: TrajectoryToolbarProps) {
  return (
    <div className="trajectory-toolbar" role="toolbar" aria-label="Trajectory controls">
      <div className="trajectory-toolbar-actions">
        <button
          type="button"
          className={`trajectory-toolbar-btn ${duration ? 'active' : ''}`}
          aria-pressed={duration}
          title={duration ? 'Switch to equal-width bars' : 'Use actual durations'}
          onClick={() => onDurationChange(!duration)}
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.25" />
            <path d="M8 4.75V8l2.25 1.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          </svg>
          Duration
        </button>
        <span className="trajectory-toolbar-sep" />
        <button type="button" className="trajectory-toolbar-btn" tabIndex={-1} title="Turns">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="4" width="12" height="2.5" rx="0.5" stroke="currentColor" strokeWidth="1.25" />
            <rect x="2" y="9.5" width="8" height="2.5" rx="0.5" stroke="currentColor" strokeWidth="1.25" />
          </svg>
          Turns <span className="trajectory-toolbar-count">{turnCount}</span>
        </button>
        <button type="button" className="trajectory-toolbar-btn" tabIndex={-1} title="Calls">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.5 11.5l3-1 2 2 4-6-2-1" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" fill="none" />
            <circle cx="12" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.25" />
          </svg>
          Calls <span className="trajectory-toolbar-count">{callCount}</span>
        </button>
      </div>
      <div className="trajectory-toolbar-search">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          aria-label="Search trajectory"
          placeholder="Search"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
        />
      </div>
    </div>
  )
}
