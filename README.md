# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kang100761/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kang100761/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar reads a sealed DefiLlama snapshot of 758 protocols and ranks the 198 that still have no token by what that token might be worth on launch day. Instead of guessing, it prices each protocol from protocols that already have a token: within each category, it takes the median market-cap-to-TVL ratio of the tokenized comparables, shrunk toward the global median (0.214, drawn from 128 comparables) so that a thin category cannot be priced off a single wild outlier.

That base price is then adjusted for the things that move a launch: 7-day TVL momentum, protocol age, and chain breadth. The result is a board sorted by implied token value, and every ranked row carries a concrete farming plan — what to do in that protocol, what it costs, and how much time it takes — so a reader can act on the ranking instead of just admiring it.

The dashboard presents the board as a sortable table with search plus category, chain, and minimum-TVL filters. Opening any protocol shows a detail view with the full valuation arithmetic behind its number: the category ratio, each adjustment, and the final implied value, all reproducible from the snapshot.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

---
<sub>Entered on [make.fun](https://make.fun/?ref=jb9nh9sn&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
