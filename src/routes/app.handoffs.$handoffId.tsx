import { createFileRoute } from '@tanstack/react-router'
import { BriefPage } from '../stump/handoffs/ui/BriefPage.tsx'

export const Route = createFileRoute('/app/handoffs/$handoffId')({ component: BriefRoute })

function BriefRoute() {
  const { handoffId } = Route.useParams()
  return <BriefPage key={handoffId} handoffId={handoffId} />
}
