import { createFileRoute } from '@tanstack/react-router'
import { TodayPage } from '../stump/today/TodayPage.tsx'

export const Route = createFileRoute('/app/')({ component: TodayPage })
