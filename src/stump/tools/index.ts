import { toolSchema } from '../actions/runner.ts'
import type { StumpTool } from '../actions/types.ts'
import { calendarTools } from './calendar.ts'
import { ledgerTools } from './ledger.ts'
import { teamTools } from './team.ts'
import { venueTools } from './venues.ts'

// Every Stump tool, one line per area (src/stump/README.md). The person door
// and the MCP door both read this list; nothing else registers tools.
export const stumpTools: readonly StumpTool[] = [
  ...calendarTools,
  ...ledgerTools,
  ...teamTools,
  ...venueTools,
]

// A tool that declares one argument two ways fails here, when the Worker starts.
for (const tool of stumpTools) toolSchema(tool)
