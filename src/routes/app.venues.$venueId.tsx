import { createFileRoute } from '@tanstack/react-router'
import { VenuePage } from '../stump/venues/ui/VenuePage.tsx'

export const Route = createFileRoute('/app/venues/$venueId')({ component: VenueRoute })

function VenueRoute() {
  const { venueId } = Route.useParams()
  return <VenuePage key={venueId} venueId={venueId} />
}
