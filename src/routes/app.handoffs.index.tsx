import { createFileRoute } from '@tanstack/react-router'
import { QueuePage } from '../stump/handoffs/ui/QueuePage.tsx'

export const Route = createFileRoute('/app/handoffs/')({ component: QueuePage })
