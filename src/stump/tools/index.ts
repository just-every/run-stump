import { toolSchema } from '../actions/runner.ts'
import type { StumpTool } from '../actions/types.ts'
import { calendarTools } from './calendar.ts'
import { findingsTools } from './findings.ts'
import { ledgerTools } from './ledger.ts'
import { linksTools } from './links.ts'
import { stackTools } from './stack.ts'
import { teamTools } from './team.ts'
import { venueTools } from './venues.ts'
import { watchesTools } from './watches.ts'

// Every Stump tool, one line per area (src/stump/README.md). The person door
// and the MCP door both read this list; nothing else registers tools.
export const stumpTools: readonly StumpTool[] = [
  ...calendarTools,
  ...findingsTools,
  ...ledgerTools,
  ...linksTools,
  ...stackTools,
  ...teamTools,
  ...venueTools,
  ...watchesTools,
]

// A tool that declares one argument two ways fails here, when the Worker starts.
for (const tool of stumpTools) toolSchema(tool)
