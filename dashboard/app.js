'use strict';
/* Token Launch Radar dashboard. Reads window.RADAR (written beside this page by the entry's
   program) and renders three views: the pre-token board, the live-token set the model calibrated
   on, and the model itself. Every figure the detail drawer prints is recomputed in the browser
   from the printed inputs, and the drawer says whether the recompute lands on the printed value. */
const R = window.RADAR;
const M = R.model;
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-US');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => (n === null || n === undefined ? '—' : '$' + nf.format(Math.round(n)));
const num = (n) => nf.format(n);
const ratio6 = (n) => n.toFixed(6);
const ratio3 = (n) => n.toFixed(3);
const mult4 = (n) => '×' + n.toFixed(4);
const pct = (n) => (n === null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%');
const clampN = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const catLabel = (c) => (c === null || c === '' ? 'Uncategorised' : c);
const TIER_ORDER = { Prime: 0, Strong: 1, Watch: 2, Speculative: 3 };

/* Recompute one row from the inputs printed beside it: the same rounding discipline the model
   itself uses (ratio as stored, multipliers at 4 decimals, confidence parts at 4 decimals). */
function recompute(row) {
  const implied = Math.max(1, Math.round(row.tvl_usd * row.category_ratio * row.momentum_multiplier * row.age_multiplier * row.breadth_multiplier));
  const low = Math.max(1, Math.round(implied / row.dispersion_factor));
  const high = Math.round(implied * row.dispersion_factor);
  const conf = clampN(Math.round(100 * (M.conf_weight_evidence * row.confidence_evidence + M.conf_weight_agreement * row.confidence_agreement + M.conf_weight_completeness * row.confidence_completeness)), 0, 100);
  return {
    implied, low, high, conf,
    ok: implied === row.implied_value_usd && low === row.implied_low_usd && high === row.implied_high_usd && conf === row.confidence,
  };
}
const CHECKS = R.rows.map((row) => ({ slug: row.slug, ...recompute(row) }));
const CHECKS_OK = CHECKS.filter((c) => c.ok).length;

const state = {
  view: 'board',
  sort: { key: 'rank', dir: 1 },
  q: '', cat: '', chain: '', minTvl: 0, minConf: 0,
  liveSort: { key: 'mcap', dir: -1 },
  liveQ: '', liveCat: '', liveComp: false,
};

/* Deep links: #view=live, #view=method, #p=<slug>, plus filter parameters for the board shot. */
function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const view = h.get('view');
  if (view === 'live' || view === 'method' || view === 'board') state.view = view;
  if (h.get('q')) state.q = h.get('q');
  if (h.get('cat')) state.cat = h.get('cat');
  if (h.get('chain')) state.chain = h.get('chain');
  if (h.get('mintvl')) state.minTvl = Number(h.get('mintvl')) || 0;
  if (h.get('minconf')) state.minConf = Number(h.get('minconf')) || 0;
  return h.get('p');
}

function buildChrome() {
  const tm = $('topmeta');
  tm.innerHTML = `<span class="pill">${esc(M.version)}</span><br>Snapshot <b>${esc(R.as_of)}</b> · universe floor <b>${money(R.floor_usd)}</b><br>`;
  const src = document.createElement('span');
  src.textContent = R.source;
  tm.appendChild(src);
  const stats = [
    { k: 'Pre-token protocols ranked', v: num(R.board_size), s: `${num(R.watchlist_size)} watchlist · ${num(R.early_size)} early, below the floor` },
    { k: 'Combined implied value', v: money(R.combined_implied_usd), s: 'if every ranked protocol launched at its model price' },
    { k: 'Calibration set', v: num(R.comparable_size), s: `tokenized comparables across ${num(R.categories.length)} categories` },
    { k: 'Global multiple', v: ratio3(M.global_ratio), s: `market cap per $1 of TVL · all-comparable dispersion ×${M.global_factor.toFixed(2)}` },
    { k: 'Median confidence', v: `${R.median_confidence} / 100`, s: `tiers: Prime ≥ ${M.tier_prime} · Strong ≥ ${M.tier_strong} · Watch ≥ ${M.tier_watch}` },
  ];
  $('stats').innerHTML = stats.map((s) => `<div class="stat"><div class="k">${esc(s.k)}</div><div class="v">${esc(s.v)}</div><div class="s">${esc(s.s)}</div></div>`).join('');
  const foot = $('foot');
  foot.textContent = `Token Launch Radar · model ${M.version} · snapshot of ${R.as_of} · ${R.board_size} pre-token protocols ranked from ${R.comparable_size} tokenized comparables · every figure on this page recomputes from the inputs printed beside it.`;
}

function fillSelect(el, values, allLabel) {
  el.innerHTML = `<option value="">${esc(allLabel)}</option>` + values.map((v) => `<option value="${esc(v.key)}">${esc(v.label)}</option>`).join('');
}

function buildFilters() {
  const cats = [...new Set(R.rows.map((r) => catLabel(r.category)))].sort();
  fillSelect($('f-cat'), cats.map((c) => ({ key: c, label: c })), 'All categories');
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  fillSelect($('f-chain'), chains.map((c) => ({ key: c, label: c })), 'All chains');
  const liveCats = [...new Set(R.live.map((r) => catLabel(r.category)))].sort();
  fillSelect($('live-cat'), liveCats.map((c) => ({ key: c, label: c })), 'All categories');
  $('q').value = state.q;
  $('f-cat').value = state.cat;
  $('f-chain').value = state.chain;
  $('f-tvl').value = String(state.minTvl);
  $('f-conf').value = String(state.minConf);
}

const maxFactor = Math.max(...R.rows.map((r) => r.dispersion_factor));
function boardRows() {
  const q = state.q.trim().toLowerCase();
  let rows = R.rows.filter((r) =>
    (q === '' || r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)) &&
    (state.cat === '' || catLabel(r.category) === state.cat) &&
    (state.chain === '' || r.chains.includes(state.chain)) &&
    r.tvl_usd >= state.minTvl &&
    r.confidence >= state.minConf);
  const { key, dir } = state.sort;
  const val = (r) => {
    switch (key) {
      case 'name': return r.name.toLowerCase();
      case 'category': return catLabel(r.category);
      case 'tvl': return r.tvl_usd;
      case 'implied': return r.implied_value_usd;
      case 'confidence': return r.confidence;
      case 'tier': return TIER_ORDER[r.tier];
      default: return r.rank;
    }
  };
  rows = [...rows].sort((a, b) => {
    const va = val(a); const vb = val(b);
    const cmp = typeof va === 'string' ? (va < vb ? -1 : va > vb ? 1 : 0) : va - vb;
    return cmp * dir || a.rank - b.rank;
  });
  return rows;
}

function renderBoard() {
  const rows = boardRows();
  $('board-count').textContent = `${num(rows.length)} of ${num(R.board_size)} protocols`;
  $('board-empty').hidden = rows.length > 0;
  $('board-body').innerHTML = rows.map((r) => {
    const width = Math.max(6, Math.round((100 * Math.log(r.dispersion_factor)) / Math.log(maxFactor)));
    return `<tr class="clickable" data-slug="${esc(r.slug)}" tabindex="0">
      <td class="num rank">${r.rank}</td>
      <td class="namecell"><span class="pname">${esc(r.name)}${r.on_watchlist ? '<span class="watchdot" title="On the snapshot watchlist">●</span>' : ''}</span><span class="pslug">${esc(r.slug)}</span></td>
      <td class="hide-m">${esc(catLabel(r.category))}</td>
      <td class="chains hide-m" title="${esc(r.chains.join(', '))}">${esc(r.chains.length > 4 ? `${r.chains.slice(0, 4).join(' · ')} +${r.chains.length - 4} more` : r.chains.join(' · ') || '—')}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num implied">${money(r.implied_value_usd)}</td>
      <td class="hide-s"><span class="range">${money(r.implied_low_usd)} – ${money(r.implied_high_usd)}</span><span class="rangebar"><i style="width:${width}%"></i></span></td>
      <td class="num"><span class="confcell"><span class="confnum">${r.confidence}</span><span class="confbar"><i style="width:${r.confidence}%"></i></span></span></td>
      <td class="hide-s"><span class="tier tier-${esc(r.tier.toLowerCase())}"><i></i>${esc(r.tier)}</span></td>
    </tr>`;
  }).join('');
  document.querySelectorAll('#board-table th.sortable').forEach((th) => {
    const active = th.dataset.sort === state.sort.key;
    th.innerHTML = th.textContent.replace(/ [↑↓]$/, '') + (active ? ` <span class="dir">${state.sort.dir === 1 ? '↑' : '↓'}</span>` : '');
  });
  $('board-foot').innerHTML = `Recompute check: <b>${num(CHECKS_OK)} of ${num(R.rows.length)} rows</b> reproduce exactly from the inputs printed in their detail view — implied value, range and confidence. Click any row for its full arithmetic and farm plan.`;
}

function liveRowsFiltered() {
  const q = state.liveQ.trim().toLowerCase();
  let rows = R.live.filter((r) =>
    (q === '' || r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q) || (r.symbol ?? '').toLowerCase().includes(q)) &&
    (state.liveCat === '' || catLabel(r.category) === state.liveCat) &&
    (!state.liveComp || r.comparable));
  const { key, dir } = state.liveSort;
  const val = (r) => {
    switch (key) {
      case 'name': return r.name.toLowerCase();
      case 'category': return catLabel(r.category);
      case 'tvl': return r.tvl_usd;
      case 'ratio': return r.ratio;
      case 'change': return r.change_7d;
      default: return r.mcap_usd !== null && r.mcap_usd > 0 ? r.mcap_usd : null;
    }
  };
  return [...rows].sort((a, b) => {
    const va = val(a); const vb = val(b);
    if (va === null && vb === null) return a.slug < b.slug ? -1 : 1;
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = typeof va === 'string' ? (va < vb ? -1 : va > vb ? 1 : 0) : va - vb;
    return cmp * dir || (a.slug < b.slug ? -1 : 1);
  });
}

function renderLive() {
  const rows = liveRowsFiltered();
  $('live-count').textContent = `${num(rows.length)} of ${num(R.live_size)} live-token protocols · ${num(R.comparable_size)} comparables`;
  $('live-empty').hidden = rows.length > 0;
  $('live-body').innerHTML = rows.map((r) => `<tr>
      <td class="namecell"><span class="pname">${esc(r.name)}</span><span class="pslug">${esc(r.slug)}</span></td>
      <td class="hide-m">${esc(r.symbol ?? '—')}</td>
      <td class="hide-m">${esc(catLabel(r.category))}</td>
      <td class="chains hide-s" title="${esc(r.chains.join(', '))}">${esc(r.chains.length > 4 ? `${r.chains.slice(0, 4).join(' · ')} +${r.chains.length - 4} more` : r.chains.join(' · ') || '—')}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num">${r.mcap_usd !== null && r.mcap_usd > 0 ? money(r.mcap_usd) : '—'}</td>
      <td class="num">${r.ratio === null ? '—' : ratio3(r.ratio)}</td>
      <td class="num hide-s"><span class="${r.change_7d === null || r.change_7d === 0 ? 'flat' : r.change_7d > 0 ? 'pos' : 'neg'}">${pct(r.change_7d)}</span></td>
      <td>${r.comparable ? '<span class="comp-yes">Comparable</span>' : '<span class="comp-no">Not used</span>'}</td>
    </tr>`).join('');
  document.querySelectorAll('#live-table th.sortable').forEach((th) => {
    const active = th.dataset.lsort === state.liveSort.key;
    th.innerHTML = th.textContent.replace(/ [↑↓]$/, '') + (active ? ` <span class="dir">${state.liveSort.dir === 1 ? '↑' : '↓'}</span>` : '');
  });
}

function renderMethod() {
  const bt = M.backtest;
  const miss = (line) => '×' + Math.exp(line.median_abs_log_error).toFixed(2);
  const catRows = R.categories.map((c) => `<tr><td>${esc(catLabel(c.category))}</td><td>${c.comps}</td><td>${ratio3(c.center_ratio)}</td><td>${ratio3(c.ratio)}</td><td>${c.sigma.toFixed(3)}</td><td>×${c.factor.toFixed(2)}</td></tr>`).join('');
  $('method-body').innerHTML = `<div class="method">
    <h2>The model in one line</h2>
    <div class="formula">implied mcap = round( TVL × category multiple × momentum × maturity × breadth )</div>
    <p>A protocol with no token is priced the way the market already prices the ones that trade. Every tokenized protocol in the same snapshot is a <b>comparable</b>: its market-cap/TVL ratio says what one dollar of locked value is worth once a token exists. radar-3 reads those ratios in log space, calibrates one multiple per category, and adjusts for what the snapshot reports about the protocol itself — its seven-day momentum, how long it has run with no token, and how many chains hold its value.</p>
    <h2>How the category multiple is calibrated</h2>
    <ul>
      <li><b>Comparables.</b> A protocol votes when it records a token and both its market cap and its TVL are real and positive: ${num(M.global_comps)} voters across ${num(R.categories.length)} categories. A market cap of 0 prices nothing, and the snapshot's −1 "not reported" sentinel is ignored, never divided by.</li>
      <li><b>Winsorized.</b> Each comparable's raw ratio is clamped to [${M.ratio_obs_floor}, ${M.ratio_obs_cap}] before it counts, so one mispriced microcap cannot drag a whole category.</li>
      <li><b>Geometric mean, shrunk.</b> A category's center is the mean of its comparables' log-ratios. Thin categories are shrunk toward the global center with a pseudo-count of K = ${M.shrink_k}: a category with 2 voters is pulled hard toward the market; one with 15 barely moves.</li>
      <li><b>Bounded.</b> No applied multiple leaves [${M.ratio_final_min}, ${M.ratio_final_max}]. A category with no comparables at all is priced off the global multiple, ${ratio3(M.global_ratio)}, and its row says so.</li>
    </ul>
    <h2>The three adjustments</h2>
    <table class="kv">
      <tr><th>Momentum</th><td>×(1 + ${M.momentum_weight} × clamp(7d change, ${M.momentum_floor}, ${M.momentum_cap}) / 100)</td><td class="note">no reported change is neutral at exactly ×1</td></tr>
      <tr><th>Maturity</th><td>×(${M.maturity_base} + ${M.maturity_range} × min(age, ${num(M.maturity_days)} days) / ${num(M.maturity_days)})</td><td class="note">an unknown age counts as 365 days</td></tr>
      <tr><th>Breadth</th><td>×(1 + ${M.breadth_per_chain} per chain past the first, up to 6)</td><td class="note">more chains, more holders to launch to</td></tr>
    </table>
    <h2>The plausible range</h2>
    <p>Comparables inside a category disagree, and the disagreement is measured, not hidden: a robust MAD sigma of the category's log-ratios, shrunk toward the pooled within-category dispersion (σ = ${M.pooled_sigma.toFixed(3)} across all categories). The factor f = e<sup>σ</sup> turns the point estimate into a band, <b>implied / f to implied × f</b> — where launches in that category have actually landed relative to the multiple. Across the whole market the dispersion is wider (×${M.global_factor.toFixed(2)}), which is exactly why the model prices by category and not by one global number.</p>
    <h2>Confidence, 0–100</h2>
    <p>Every row states how much its own number should be trusted, from three parts: <b>evidence</b> (${Math.round(M.conf_weight_evidence * 100)}% — how many comparables priced the row, n / (n + ${M.conf_evidence_k})), <b>agreement</b> (${Math.round(M.conf_weight_agreement * 100)}% — how tightly they agree, 1 / (1 + σ)), and <b>completeness</b> (${Math.round(M.conf_weight_completeness * 100)}% — how much of the protocol's own record the snapshot reports: 7d change, listing date, category, chains). Tiers: <b>Prime ≥ ${M.tier_prime}</b>, <b>Strong ≥ ${M.tier_strong}</b>, <b>Watch ≥ ${M.tier_watch}</b>, Speculative below. The board's biggest prize can honestly carry a middling score: the top rows sit in a category with a single comparable, and the score says so.</p>
    <h2>Category calibration</h2>
    <div class="catwrap"><table class="cats"><thead><tr><th>Category</th><th>Comparables</th><th>Center</th><th>Applied ×</th><th>σ</th><th>Range factor</th></tr></thead>
    <tbody><tr><td>All categories (global)</td><td>${M.global_comps}</td><td>${ratio3(M.global_ratio)}</td><td>${ratio3(M.global_ratio)}</td><td>${M.global_sigma.toFixed(3)}</td><td>×${M.global_factor.toFixed(2)}</td></tr>${catRows}</tbody></table></div>
    <h2>Backtest: pricing the protocols that already have tokens</h2>
    <p>The model's own exam, sat on this snapshot: each of the ${bt.n} comparables is priced as if it were pre-token, with its own observation left out of every figure it is priced with, and the estimate is compared with its real market cap. Three rules sit the same exam.</p>
    <table class="kv">
      <tr><th>Naive global multiple</th><td>median |log error| ${bt.naive.median_abs_log_error.toFixed(4)}</td><td>typical miss ${miss(bt.naive)}</td><td>within 2× for ${bt.naive.within_2x_pct.toFixed(1)}%</td></tr>
      <tr><th>Category multiple alone</th><td>median |log error| ${bt.category.median_abs_log_error.toFixed(4)}</td><td>typical miss ${miss(bt.category)}</td><td>within 2× for ${bt.category.within_2x_pct.toFixed(1)}%</td></tr>
      <tr><th>radar-3, full model</th><td>median |log error| ${bt.full.median_abs_log_error.toFixed(4)}</td><td>typical miss ${miss(bt.full)}</td><td>within 2× for ${bt.full.within_2x_pct.toFixed(1)}%</td></tr>
    </table>
    <p>Category calibration is the big win: the typical error falls from ${miss(bt.naive)} to ${miss(bt.category)} against the naive multiple, because a dollar of lending TVL and a dollar of DEX TVL are not worth the same. The naive rule still lands within 2× slightly more often — it parks every estimate in the middle of the distribution, so it is often vaguely close and never specifically right, and it cannot tell one category from another at all. The full model's adjustments cost it a little on this exam, for a stated reason: a comparable's momentum and age are already inside its real market cap, so re-applying them double-counts. For a protocol with no token — the board's actual subject — those are precisely the signals a bare multiple misses. No TVL-based model prices launches tightly; that is why every row carries its range and its confidence instead of pretending otherwise.</p>
    <h2>The universe</h2>
    <p>The board ranks ${num(R.board_size)} protocols: the snapshot's ${num(R.watchlist_size)}-strong watchlist, covered whole, plus ${num(R.early_size)} early protocols the same screen finds below the ${money(R.floor_usd)} floor. The screen is the house's own, with no TVL floor: a protocol is rankable when it records no token and is not a wrapped, staked or bridged product of one that trades — its category is not a bridge, liquid-staking, restaking or exchange category, its name ends in no version marker, carries no whole word wrapped, staked or staking, and begins with no exchange's name. No protocol is special-cased, and none is ranked by a hardcoded figure.</p>
    <h2>Edge cases and integrity</h2>
    <ul>
      <li>The one protocol carrying the −1 market-cap sentinel is treated as unreported, never as a negative price; zero caps vote in nothing.</li>
      <li>Missing 7-day changes are neutral, missing listing dates count as a 365-day age, and no row can emit NaN or infinity — the program refuses to write a board that breaks its own rules.</li>
      <li>The run is deterministic: the same snapshot produces byte-identical outputs, twice verified.</li>
      <li>Every row recomputes on this page from its printed inputs: <b>${num(CHECKS_OK)} of ${num(R.rows.length)} rows reproduce exactly</b> — check any row's detail view.</li>
    </ul>
  </div>`;
}

function openDrawer(slug) {
  const r = R.rows.find((row) => row.slug === slug);
  if (!r) return;
  const check = recompute(r);
  const momWhy = r.momentum_pct === null ? 'no 7d change reported — neutral' : `7d change ${pct(r.momentum_pct)}${r.change_7d !== null && r.change_7d !== r.momentum_pct ? ` (reported ${pct(r.change_7d)}, clamped)` : ''}`;
  const ageWhy = r.age_days === null ? 'no listing date — counted as 365 days' : `listed ${num(r.age_days)} days ago`;
  const catWhy = r.used_global_ratio
    ? `${catLabel(r.category)} has no tokenized comparables — priced off the global multiple`
    : `${catLabel(r.category)} · ${r.ratio_comps} comparable${r.ratio_comps === 1 ? '' : 's'} · center ${ratio6(r.center_ratio)} before shrinkage`;
  const part = (label, value) => `<div class="confpart"><span>${label}</span><span class="bar"><i style="width:${Math.round(value * 100)}%"></i></span><span class="pv">${value.toFixed(4)}</span></div>`;
  $('drawer-body').innerHTML = `
    <h2>${esc(r.name)}</h2>
    <div class="dsub">${esc(r.slug)} · rank ${r.rank} of ${num(R.board_size)}</div>
    <div class="dbadges">
      <span class="badge accent">${esc(r.tier)} · confidence ${r.confidence}</span>
      <span class="badge">${esc(catLabel(r.category))}</span>
      ${r.on_watchlist ? '<span class="badge">Watchlist</span>' : '<span class="badge">Early — below the floor</span>'}
      <span class="badge">Pre-token</span>
    </div>
    <div class="bigfig">
      <div class="bf"><div class="k">Implied mcap</div><div class="v">${money(r.implied_value_usd)}</div></div>
      <div class="bf"><div class="k">Plausible range</div><div class="v">${money(r.implied_low_usd)} – ${money(r.implied_high_usd)}</div></div>
      <div class="bf"><div class="k">TVL</div><div class="v">${money(r.tvl_usd)}</div></div>
    </div>
    <h3>The arithmetic</h3>
    <table class="calc">
      <tr><th>Total value locked</th><td>${money(r.tvl_usd)}</td></tr>
      <tr><th>Category multiple<span class="why">${esc(catWhy)}</span></th><td>${ratio6(r.category_ratio)}</td></tr>
      <tr><th>Momentum<span class="why">${esc(momWhy)}</span></th><td>${mult4(r.momentum_multiplier)}</td></tr>
      <tr><th>Maturity<span class="why">${esc(ageWhy)}</span></th><td>${mult4(r.age_multiplier)}</td></tr>
      <tr><th>Breadth<span class="why">${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}: ${esc(r.chains.join(', ') || 'none reported')}</span></th><td>${mult4(r.breadth_multiplier)}</td></tr>
      <tr class="total"><th>Implied market cap</th><td>${money(r.implied_value_usd)}</td></tr>
      <tr><th>Range<span class="why">dispersion σ ${r.sigma.toFixed(4)} → factor ${mult4(r.dispersion_factor)}; low = implied / f, high = implied × f</span></th><td>${money(r.implied_low_usd)} – ${money(r.implied_high_usd)}</td></tr>
    </table>
    <div class="checkline ${check.ok ? 'ok' : 'bad'}">${check.ok ? '✓ Recomputed on this page from the inputs above: implied value, range and confidence all reproduce exactly.' : '✗ Recompute mismatch — this row does not reproduce from its printed inputs.'}</div>
    <h3>Confidence — ${r.confidence} / 100 (${esc(r.tier)})</h3>
    <div class="confparts">
      ${part('Evidence', r.confidence_evidence)}
      ${part('Agreement', r.confidence_agreement)}
      ${part('Completeness', r.confidence_completeness)}
    </div>
    <h3>Farm plan</h3>
    <p class="plannote">${esc(r.plan_note)}</p>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  $('drawer').hidden = false;
  $('scrim').hidden = false;
}
function closeDrawer() {
  $('drawer').hidden = true;
  $('scrim').hidden = true;
}

function switchView(view) {
  state.view = view;
  for (const v of ['board', 'live', 'method']) {
    $(`view-${v}`).hidden = v !== view;
    $(`tab-${v}`).classList.toggle('is-active', v === view);
  }
  if (view === 'live') renderLive();
  if (view === 'method') renderMethod();
}

function wire() {
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));
  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
  $('f-cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
  $('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
  $('f-tvl').addEventListener('change', (e) => { state.minTvl = Number(e.target.value); renderBoard(); });
  $('f-conf').addEventListener('change', (e) => { state.minConf = Number(e.target.value); renderBoard(); });
  document.querySelectorAll('#board-table th.sortable').forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sort.key === key) state.sort.dir *= -1;
    else state.sort = { key, dir: key === 'name' || key === 'category' ? 1 : -1 };
    if (key === 'rank') state.sort.dir = 1;
    renderBoard();
  }));
  $('board-body').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) openDrawer(tr.dataset.slug);
  });
  $('board-body').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const tr = e.target.closest('tr[data-slug]');
      if (tr) openDrawer(tr.dataset.slug);
    }
  });
  $('live-q').addEventListener('input', (e) => { state.liveQ = e.target.value; renderLive(); });
  $('live-cat').addEventListener('change', (e) => { state.liveCat = e.target.value; renderLive(); });
  $('live-comp').addEventListener('change', (e) => { state.liveComp = e.target.checked; renderLive(); });
  document.querySelectorAll('#live-table th.sortable').forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.lsort;
    if (state.liveSort.key === key) state.liveSort.dir *= -1;
    else state.liveSort = { key, dir: key === 'name' || key === 'category' ? 1 : -1 };
    renderLive();
  }));
  $('drawer-close').addEventListener('click', closeDrawer);
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
}

const deepSlug = readHash();
buildChrome();
buildFilters();
wire();
renderBoard();
switchView(state.view);
if (deepSlug) openDrawer(deepSlug);
