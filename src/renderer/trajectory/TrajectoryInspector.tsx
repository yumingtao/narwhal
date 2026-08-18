/** TrajectoryInspector — right-side detail panel for selected record. */

import { useState } from 'react'
import type { TrajectoryRecord } from './types'
import { kindLabel, kindColor } from './builder'
import { MarkdownMessage } from '../main'

interface TrajectoryInspectorProps {
  readonly record: TrajectoryRecord | null
  readonly onClose: () => void
}

type InspectorTab = 'prompt' | 'input' | 'output' | 'thinking' | 'tools' | 'meta'

function availableTabs(record: TrajectoryRecord): InspectorTab[] {
  const tabs: InspectorTab[] = []
  if (record.promptDetail) tabs.push('prompt')
  if (record.inputDetail) tabs.push('input')
  if (record.outputDetail) tabs.push('output')
  if (record.thinkingDetail) tabs.push('thinking')
  if (record.kind === 'tool' || record.kind === 'subtool') tabs.push('tools')
  tabs.push('meta')
  return tabs
}

function tabLabel(tab: InspectorTab): string {
  switch (tab) {
    case 'prompt': return 'System Prompt'
    case 'input': return 'Input'
    case 'output': return 'Output'
    case 'thinking': return 'Thinking'
    case 'tools': return 'Tools'
    case 'meta': return 'Details'
  }
}

export function TrajectoryInspector({ record, onClose }: TrajectoryInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('meta')

  if (!record) return null

  const color = kindColor(record.kind)
  const tabs = availableTabs(record)

  // Ensure current tab is valid for this record
  const activeTab = tabs.includes(tab) ? tab : tabs[0]

  return (
    <aside className="trajectory-inspector" aria-label="Record details">
      <header className="trajectory-inspector-header">
        <div className="trajectory-inspector-title">
          <span
            className="trajectory-kind-badge"
            style={{ backgroundColor: color + '22', color, borderColor: color + '55' }}
          >
            {kindLabel(record.kind)}
          </span>
          <strong>#{record.index}</strong>
        </div>
        <button className="trajectory-inspector-close" aria-label="Close details" onClick={onClose}>
          ×
        </button>
      </header>
      {tabs.length > 1 && (
        <nav className="trajectory-inspector-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={activeTab === t}
              className={activeTab === t ? 'active' : ''}
              onClick={() => setTab(t)}
            >
              {tabLabel(t)}
            </button>
          ))}
        </nav>
      )}
      <div className="trajectory-inspector-body">
        {activeTab === 'prompt' && record.promptDetail && (
          <div className="trajectory-inspector-section">
            <div className="trajectory-inspector-label">System Prompt</div>
            <div className="trajectory-inspector-content">
              <MarkdownMessage content={record.promptDetail} />
            </div>
          </div>
        )}
        {activeTab === 'input' && record.inputDetail && (
          <div className="trajectory-inspector-section">
            <div className="trajectory-inspector-label">Input</div>
            <div className="trajectory-inspector-content">
              <MarkdownMessage content={record.inputDetail} />
            </div>
          </div>
        )}
        {activeTab === 'output' && record.outputDetail && (
          <div className="trajectory-inspector-section">
            <div className="trajectory-inspector-label">Output</div>
            <div className="trajectory-inspector-content">
              <MarkdownMessage content={record.outputDetail} />
            </div>
          </div>
        )}
        {activeTab === 'thinking' && record.thinkingDetail && (
          <div className="trajectory-inspector-section">
            <div className="trajectory-inspector-label">Thinking</div>
            <div className="trajectory-inspector-content">
              <MarkdownMessage content={record.thinkingDetail} />
            </div>
          </div>
        )}
        {activeTab === 'tools' && (
          <div className="trajectory-inspector-section">
            <div className="trajectory-inspector-label">Tool Call</div>
            <div className="trajectory-inspector-content">
              <pre className="trajectory-inspector-pre">{record.text}</pre>
            </div>
          </div>
        )}
        {activeTab === 'meta' && (
          <>
            <div className="trajectory-inspector-section">
              <div className="trajectory-inspector-label">Kind</div>
              <div className="trajectory-inspector-value">{kindLabel(record.kind)}</div>
            </div>
            <div className="trajectory-inspector-section">
              <div className="trajectory-inspector-label">Turn</div>
              <div className="trajectory-inspector-value">Turn {record.turn}</div>
            </div>
            <div className="trajectory-inspector-section">
              <div className="trajectory-inspector-label">Content</div>
              <div className="trajectory-inspector-content">
                <MarkdownMessage content={record.text} />
              </div>
            </div>
            {record.tokens && (
              <div className="trajectory-inspector-section">
                <div className="trajectory-inspector-label">Tokens</div>
                <dl className="trajectory-inspector-tokens">
                  {record.tokens.input !== undefined && <><dt>Input</dt><dd>{record.tokens.input.toLocaleString()}</dd></>}
                  {record.tokens.cacheRead !== undefined && <><dt>Cache Read</dt><dd>{record.tokens.cacheRead.toLocaleString()}</dd></>}
                  {record.tokens.cacheWrite !== undefined && <><dt>Cache Write</dt><dd>{record.tokens.cacheWrite.toLocaleString()}</dd></>}
                  {record.tokens.output !== undefined && <><dt>Output</dt><dd>{record.tokens.output.toLocaleString()}</dd></>}
                  {record.tokens.reasoning !== undefined && <><dt>Reasoning</dt><dd>{record.tokens.reasoning.toLocaleString()}</dd></>}
                </dl>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
