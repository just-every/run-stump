import { toolSchema } from '../actions/runner.ts'
import type { StumpTool } from '../actions/types.ts'
import { accountTools } from './accounts.ts'
import { calendarTools } from './calendar.ts'
import { itemTools } from './items.ts'
import { ledgerTools } from './ledger.ts'
import { setupTools } from './setup.ts'
import { teamTools } from './team.ts'

// Every Stump tool, one line per area (src/stump/README.md). The person door
// and the MCP door both read this list; nothing else registers tools.
export const stumpTools: readonly StumpTool[] = [
  ...accountTools,
  ...calendarTools,
  ...itemTools,
  ...ledgerTools,
  ...setupTools,
  ...teamTools,
]

// A tool that declares one argument two ways fails here, when the Worker starts.
for (const tool of stumpTools) toolSchema(tool)
