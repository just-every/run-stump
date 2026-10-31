# Measured rates

Each statistical check in `CONTRACT.md` has a labelled fixture with a pass/fail bar, and each release publishes the rate it measured here. No rate has been measured for 0.1.0, which does not include the labelled fixtures behind these checks; each row says what its fixture measures and the bar it must clear.

| Check | Clause | Fixture | Bar | Measured | Run |
| --- | --- | --- | --- | --- | --- |
| Venue fit | STUMP-VENUE-003 | Fit fixture | Every venue's computed fit equals its expected score | not run | |
| Finding ranking | STUMP-WATCH-005 | Labelled ranking fixture | At least 7 of each day's top 10 labelled useful | not run | |
| Learning from marks | STUMP-WATCH-005 | Two-week marked fixture | Kinds marked not useful in the top 10 fall to at most half | not run | |
| Claim extraction | STUMP-BRAND-004 | Labelled claims fixture | Recall at least 90%, false flags at most 5% | not run | |
| Near-duplicate hold | STUMP-TRUTH-004 | Labelled pair fixture | At least 95% of near-duplicate pairs held, at most 5% of distinct pairs | not run | |
| Sentiment | STUMP-WATCH-008 | Labelled sentiment fixture | At least 85% correct, at most 3% opposite | not run | |
| Substantive engagement | STUMP-STACK-002 | Labelled engager fixture | At least 90% of substantive offered, at most 10% of passing reactions | not run | |
| Voice reading | STUMP-LOOP-007 | Labelled voice fixture | Own held-out posts at least 20 points above other writers on average | not run | |
