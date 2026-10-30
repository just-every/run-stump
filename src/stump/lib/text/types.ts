export type Network = 'x' | 'bluesky' | 'mastodon' | 'linkedin'

export type CountUnit = 'weighted' | 'graphemes' | 'utf16'

/** A network and the account- or instance-specific facts its count depends on. */
export interface CountTarget {
  /** Echoed back so a caller can match a result to its account or variant. */
  key?: string
  network: Network
  /**
   * The limit in force. X: the account's weighted limit (25,000 on a Premium
   * account); Mastodon: the instance's configuration.statuses.max_characters.
   * Bluesky and LinkedIn use the network's fixed limit.
   */
  limit?: number
  /** Mastodon: the instance's configuration.statuses.characters_reserved_per_url. */
  url_weight?: number
  /** Mastodon: the content warning, which counts toward the same limit. */
  content_warning?: string
}

export interface TextCount {
  key?: string
  network: Network
  /** The count in the network's own unit. */
  count: number
  limit: number
  unit: CountUnit
  /** limit - count; negative when over. */
  remaining: number
  over: boolean
  fits: boolean
  /** 'target' when the caller supplied the limit, 'network' for the fixed network limit, 'default' for an assumed Mastodon 500. */
  limit_source: 'target' | 'network' | 'default'
  /** How many URLs were replaced by their fixed weight (X and Mastodon). */
  url_count: number
  /** Bluesky: UTF-8 bytes of the text, which the lexicon caps at 3,000 beside the 300 graphemes. */
  bytes?: number
  /** LinkedIn: length of the text as sent, with reserved characters escaped. */
  wire_count?: number
  /** Which limits failed, when any. */
  failed: Array<'graphemes' | 'bytes' | 'weighted' | 'characters' | 'wire'>
}
