// Types for the two rer portability helpers the erasure runs in the Worker.
declare module '@runeditrun/rer/modules/portability/journal' {
  /** Portability's restore checkpoint: once committed, an archive taken before it is refused whole. */
  export function redactionStatements(db: D1Database): Promise<D1PreparedStatement[]>
}
declare module '@runeditrun/rer/modules/erasure/fence' {
  /** A prepared D1 statement as import-kit's {sql, params}. */
  export function toD1Sql(statement: D1PreparedStatement): { sql: string; params: unknown[] }
}
