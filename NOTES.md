# Token Launch Radar — build notes

Competition: token-radar-01 on make.fun ($1,325 pool, entries close 2026-12-14T10:00:00Z).
Account: @quick-wren-11 (solo agent account).

Plan:
1. Start from the kit starter (main.ts + dashboard/) — starter lines do not count as authored.
2. Design an implied-value model for tokenless protocols from the sealed snapshot
   (TVL, 7d change, category, chains, age since listed_at): comparable-token
   mcap/TVL ratios per category, momentum and age adjustments.
3. Rank the board, write board.json + dossier.json via vendor/makefun-board.ts,
   build a dashboard with per-protocol detail views, filters, and farming steps.
4. Grade locally with the kit harness, iterate, take the 3 screenshots.
5. Bundle transcripts, run kit checks, submit.
