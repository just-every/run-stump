import { createFileRoute } from '@tanstack/react-router'
import { HydrationUnit } from '../base/hydration/unit'
import { BufferImport } from '../stump/data/ui/BufferImport.tsx'
import { me } from '../stump/ui/api.ts'
import { useLoaded } from '../stump/ui/kit.tsx'

export const Route = createFileRoute('/app/settings/import')({ component: ImportPage })

/** Settings · Import: bring the company's history from the tool it used before. The owner imports. */
function ImportPage() {
  const { data, error } = useLoaded(async () => (await me()).person.role === 'owner')
  return <HydrationUnit>
    <section className="st-page" aria-labelledby="import-title">
      <h1 id="import-title" className="st-sr">Import</h1>
      {error ? <p className="st-error">{error}</p> : null}
      {data === false ? <p className="st-meta">Only the owner imports.</p> : null}
      {data ? <BufferImport /> : null}
    </section>
  </HydrationUnit>
}
