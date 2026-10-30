import { randomUUID } from 'node:crypto'

// A stand-in credential, made fresh for each disposable installation.
export default () => `synthetic-stump-${randomUUID()}`
