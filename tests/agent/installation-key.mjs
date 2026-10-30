import { randomBytes } from 'node:crypto'

// The disposable installation's own key for sealing the company's app keys and
// account tokens, made fresh for each conformance run.
export default function installationKey() { return randomBytes(32).toString('hex') }
