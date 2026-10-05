export type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'
export type PlanSubstep = { title: string; status: StepStatus; startedAt?: number; endedAt?: number }
export type PlanStep = { title: string; status: StepStatus; substeps: PlanSubstep[]; startedAt?: number; endedAt?: number }
export type PlanStage = { name: string; steps: PlanStep[] }
export type PlanState = 'running' | 'needs_input' | 'error' | 'done'
// one subagent shown as a state strip under a bar; depth 1 sits under its parent agent
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
  // when the current batch of agents all finished; their strips fold a few seconds later
  agentsDoneAt?: number | null
  hidden?: boolean
  isFolded?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'plan-progress': {
      plans: Plan[]
      isOpen: boolean
      // bumped while agents run or a bar is live, so elapsed times and folding redraw
      tick: number
      isRestoreChecked: boolean
      isExpanded: boolean
      backgroundTaskIds: string[]
      expandedIds: string[]
      isHistoryOpen: boolean
      paneState: 'down' | 'up' | 'unplaced'
    }
  }
}
