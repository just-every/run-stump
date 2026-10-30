import { createFileRoute } from '@tanstack/react-router'
import { AgentsSettings } from '../stump/agent-door/ui/AgentsSettings.tsx'

export const Route = createFileRoute('/app/settings/agents')({ component: AgentsSettings })
