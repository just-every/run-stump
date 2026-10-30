import { createFileRoute, redirect } from '@tanstack/react-router'

// Pausing lives in one place: the top bar's control, with its banner over Today
// while paused, and each account's pause and the history under Settings ·
// Publishing. This address opens Today, where the paused state shows.
export const Route = createFileRoute('/app/pause')({
  beforeLoad: () => { throw redirect({ to: '/app' }) },
})
