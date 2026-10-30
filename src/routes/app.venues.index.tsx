import { createFileRoute } from '@tanstack/react-router'
import { VenuesPage } from '../stump/venues/ui/VenuesPage.tsx'

export const Route = createFileRoute('/app/venues/')({ component: VenuesPage })
