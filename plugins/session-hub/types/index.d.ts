export type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'
export type PlanSubstep = { title: string; status: StepStatus; startedAt?: number; endedAt?: number }
export type PlanStep = { title: string; status: StepStatus; substeps: PlanSubstep[]; startedAt?: number; endedAt?: number }
export type PlanStage = { name: string; steps: PlanStep[] }
export type PlanState = 'running' | 'needs_input' | 'error' | 'done'
export type AgentRun = {
  id: string
  title: string
  state: 'running' | 'waiting' | 'done' | 'error'
  tool: string
  startedAt: number
  endedAt: number | null
  depth: number
}
export type Plan = {
  id: string
  title: string
  kind: 'plan' | 'todo'
  stages: PlanStage[]
  state: PlanState
  note: string | null
  startedAt: number
  updatedAt?: number
  agents?: AgentRun[]
  agentsDoneAt?: number | null
  hidden?: boolean
  isFolded?: boolean
}

export type SuggestionKind = 'verify' | 'dig' | 'advance' | 'decide'
export type Suggestion = { kind: SuggestionKind; label: string; why: string; prompt: string }
export type View = { kind: 'hidden' } | { kind: 'loading'; turnId: string } | { kind: 'offer'; items: Suggestion[]; goal: string }
export type OfferRecord = { labels: string[]; picked: number | null }

export type CacheTtl = '5m' | '1h'

export type HubSection = 'progress' | 'next'
export type HubPaneState = 'down' | 'up' | 'unplaced'

declare module 'claude-code' {
  interface PluginState {
    'session-hub': {
      plans: Plan[]
      isOpen: boolean
      tick: number
      isRestoreChecked: boolean
      isExpanded: boolean
      backgroundTaskIds: string[]
      expandedIds: string[]
      isHistoryOpen: boolean
      paneState: HubPaneState
      section: HubSection
      view: View
      history: OfferRecord[]
      lastResponseAt: number | null
      ttl: CacheTtl | null
      cacheLabel: string
    }
  }
}
