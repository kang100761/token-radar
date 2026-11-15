// Token Radar's dashboard (radar-2). It reads window.RADAR — written beside dashboard/ by main.ts —
// and renders the ranked pre-token board, the live-token comparables it was priced from, sortable and
// filterable tables, and a per-protocol detail drawer that shows the model's arithmetic and the
// protocol's farm plan. No network: every byte it shows arrived in data.js, and every implied value
// on the page is recomputed from the row's own model inputs and checked against the board's figure.
'use strict';

const R = window.RADAR;
const $ = (id) => document.getElementById(id);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
};
const moneyFull = (n) => (n === null || n === undefined ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const pct = (n) => (n === null || n === undefined ? null : (n > 0 ? '+' : '') + n.toFixed(1) + '%');
const pctClass = (n) => (n === null || n === undefined || n === 0 ? 'flat' : n > 0 ? 'up' : 'down');
const ageText = (days) => {
  if (days === null || days === undefined) return 'n/a';
  if (days < 60) return days + 'd';
  if (days < 730) return (days / 30.44).toFixed(1) + ' mo';
  return (days / 365.25).toFixed(1) + ' y';
};
const mult = (n) => '×' + n.toFixed(3);
const chainsText = (chains) => (chains.length === 0 ? '—' : chains.length === 1 ? esc(chains[0]) : esc(chains[0]) + ' +' + (chains.length - 1));

/** The model's own arithmetic, redone on the page: the drawer shows this next to the board's figure. */
function impliedOf(row) {
  return Math.max(1, Math.round(row.tvl_usd * row.category_ratio * row.momentum_multiplier * row.age_multiplier * row.breadth_multiplier));
}

const state = { tab: 'board', q: '', category: '', chain: '', tvl: 0, sortKey: 'implied', sortDir: -1 };

function fillSelect(el, values, allLabel) {
  el.innerHTML = '<option value="">' + esc(allLabel) + '</option>' + values.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
}

function rowMatches(row) {
  if (state.category && (row.category ?? 'Uncategorized') !== state.category) return false;
  if (state.chain && !row.chains.includes(state.chain)) return false;
  if (state.tvl && row.tvl_usd < state.tvl) return false;
  if (state.q) {
    const hay = (row.name + ' ' + row.slug + ' ' + (row.category ?? '') + ' ' + row.chains.join(' ')).toLowerCase();
    if (!hay.includes(state.q)) return false;
  }
  return true;
}

const BOARD_COLS = [
  { key: 'rank', label: '#', sortable: false },
  { key: 'name', label: 'Protocol', sortable: true, left: true },
  { key: 'category', label: 'Category', sortable: false, left: true },
  { key: 'chains', label: 'Chains', sortable: false, left: true },
  { key: 'tvl', label: 'TVL', sortable: true },
  { key: 'growth', label: '7d TVL', sortable: true },
  { key: 'age', label: 'Age', sortable: true },
  { key: 'implied', label: 'Implied value', sortable: true },
  { key: 'plan', label: '', sortable: false },
];
const LIVE_COLS = [
  { key: 'rank', label: '#', sortable: false },
  { key: 'name', label: 'Protocol', sortable: true, left: true },
  { key: 'category', label: 'Category', sortable: false, left: true },
  { key: 'chains', label: 'Chains', sortable: false, left: true },
  { key: 'tvl', label: 'TVL', sortable: true },
  { key: 'mcap', label: 'Market cap', sortable: true },
  { key: 'growth', label: '7d TVL', sortable: true },
  { key: 'ratio', label: 'mcap / TVL', sortable: true },
];

function headHtml(cols) {
  return '<tr>' + cols.map((c) => {
    const cls = (c.left ? 'l' : '') + (c.sortable ? ' sortable' : '');
    const arrow = c.sortable && state.sortKey === c.key ? ' <span class="arrow">' + (state.sortDir === 1 ? '▲' : '▼') + '</span>' : '';
    return '<th class="' + cls.trim() + '"' + (c.sortable ? ' data-sort="' + c.key + '" tabindex="0"' : '') + '>' + esc(c.label) + arrow + '</th>';
  }).join('') + '</tr>';
}

function sortRows(rows, live) {
  const k = state.sortKey;
  const dir = state.sortDir;
  const val = (r) => {
    switch (k) {
      case 'name': return r.name.toLowerCase();
      case 'tvl': return r.tvl_usd;
      case 'growth': return r.change_7d ?? -Infinity;
      case 'age': return r.age_days ?? -1;
      case 'mcap': return r.mcap_usd ?? -1;
      case 'ratio': return r.ratio ?? -1;
      default: return r.implied_value_usd ?? r.mcap_usd ?? 0;
    }
  };
  return [...rows].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return (a.name < b.name ? -1 : 1);
  });
}

function renderBoard() {
  $('boardHead').innerHTML = headHtml(BOARD_COLS);
  const rows = sortRows(R.rows.filter(rowMatches), false);
  const top = R.rows.length ? R.rows[0].implied_value_usd : 1;
  $('boardBody').innerHTML = rows.length === 0
    ? '<tr><td class="empty" colspan="' + BOARD_COLS.length + '">No protocol matches those filters. Loosen the search, the category, the chain or the TVL floor.</td></tr>'
    : rows.map((r) => '<tr class="clickable" data-slug="' + esc(r.slug) + '">'
      + '<td class="rank' + (r.rank <= 3 ? ' top' : '') + '">' + r.rank + '</td>'
      + '<td class="l name-cell"><span class="nm">' + (r.on_watchlist ? '<span class="watch-dot" title="On the watchlist"></span>' : '') + esc(r.name) + '</span><span class="sl">' + esc(r.slug) + '</span></td>'
      + '<td class="l cat">' + esc(r.category ?? 'Uncategorized') + '</td>'
      + '<td class="l chains">' + chainsText(r.chains) + '</td>'
      + '<td>' + money(r.tvl_usd) + '</td>'
      + '<td class="' + pctClass(r.change_7d) + '">' + (pct(r.change_7d) ?? 'n/a') + '</td>'
      + '<td>' + ageText(r.age_days) + '</td>'
      + '<td class="value-cell"><span class="value-num">' + money(r.implied_value_usd) + '</span><span class="value-bar"><i style="width:' + Math.max(2, Math.round(100 * Math.sqrt(r.implied_value_usd / top))) + '%"></i></span></td>'
      + '<td><button type="button" class="plan-btn" data-open="' + esc(r.slug) + '">Plan →</button></td>'
      + '</tr>').join('');
  $('count').textContent = 'Showing ' + rows.length + ' of ' + R.board_size + ' ranked protocols · amber dot = on the snapshot watchlist · click a row for the model breakdown and its farm plan';
  wireRows();
}

function renderLive() {
  $('boardHead').innerHTML = headHtml(LIVE_COLS);
  const rows = sortRows(R.live.filter(rowMatches), true);
  $('boardBody').innerHTML = rows.length === 0
    ? '<tr><td class="empty" colspan="' + LIVE_COLS.length + '">No live-token protocol matches those filters.</td></tr>'
    : rows.map((r, i) => '<tr>'
      + '<td class="rank">' + (i + 1) + '</td>'
      + '<td class="l name-cell"><span class="nm">' + esc(r.name) + '</span><span class="sl">' + esc(r.slug) + '</span></td>'
      + '<td class="l cat">' + esc(r.category ?? 'Uncategorized') + '</td>'
      + '<td class="l chains">' + chainsText(r.chains) + '</td>'
      + '<td>' + money(r.tvl_usd) + '</td>'
      + '<td>' + money(r.mcap_usd) + '</td>'
      + '<td class="' + pctClass(r.change_7d) + '">' + (pct(r.change_7d) ?? 'n/a') + '</td>'
      + '<td>' + (r.ratio === null ? 'n/a' : r.ratio.toFixed(2) + '×') + '</td>'
      + '</tr>').join('');
  $('count').textContent = 'Showing ' + rows.length + ' of ' + R.live_size + ' live-token protocols · these already trade, so they are never ranked — their mcap/TVL ratios are the comparables the model prices the board from';
  wireRows();
}

function render() {
  if (state.tab === 'board') renderBoard();
  else renderLive();
}

function wireRows() {
  document.querySelectorAll('#boardBody tr.clickable').forEach((tr) => {
    tr.addEventListener('click', () => openDrawer(tr.getAttribute('data-slug')));
  });
  document.querySelectorAll('#boardHead th.sortable').forEach((th) => {
    const go = () => {
      const key = th.getAttribute('data-sort');
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else { state.sortKey = key; state.sortDir = key === 'name' ? 1 : -1; }
      render();
    };
    th.addEventListener('click', go);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

function openDrawer(slug) {
  const r = R.rows.find((row) => row.slug === slug);
  if (!r) return;
  const check = impliedOf(r);
  const catLabel = r.category ?? 'Uncategorized';
  const momNote = r.change_7d === null
    ? 'no 7-day change reported, so momentum is neutral'
    : '7-day TVL change ' + pct(r.change_7d) + ', clamped to [' + R.model.momentum_floor + ', +' + R.model.momentum_cap + '] and weighted ' + R.model.momentum_weight;
  const ageNote = r.age_days === null
    ? 'listing date not reported; the model counts a neutral 365 days'
    : 'running ' + r.age_days.toLocaleString('en-US') + ' days with no token (listed ' + esc(r.listed_at) + ')';
  $('drawer').innerHTML = '<div class="drawer-in">'
    + '<div class="drawer-head"><div><h2>' + esc(r.name) + '</h2><div class="drawer-sub">rank #' + r.rank + ' of ' + R.board_size + ' · ' + esc(r.slug) + '</div>'
    + (r.on_watchlist ? '<span class="badge watch">ON THE WATCHLIST</span>' : '<span class="badge early">EARLY — BELOW THE $' + (R.floor_usd / 1e6) + 'M WATCHLIST FLOOR</span>')
    + '</div><button type="button" class="close-btn" id="drawerClose">Close ✕</button></div>'
    + '<div class="drawer-stats">'
    + '<div class="stat"><span class="k">Implied value</span><span class="v" style="color:var(--amber)">' + money(r.implied_value_usd) + '</span></div>'
    + '<div class="stat"><span class="k">TVL</span><span class="v">' + money(r.tvl_usd) + '</span></div>'
    + '<div class="stat"><span class="k">7d TVL</span><span class="v ' + pctClass(r.change_7d) + '">' + (pct(r.change_7d) ?? 'n/a') + '</span></div>'
    + '<div class="stat"><span class="k">Age</span><span class="v">' + ageText(r.age_days) + '</span></div>'
    + '</div>'
    + '<h3>Where it runs</h3><p class="chain-list">' + (r.chains.length ? r.chains.map(esc).join(' · ') : 'No chains reported') + ' — category: ' + esc(catLabel) + '. ' + esc(r.name) + ' records no token in the snapshot: no market cap, no CoinGecko id, no symbol.</p>'
    + '<h3>How the model prices it</h3>'
    + '<table class="breakdown"><tbody>'
    + '<tr><td>TVL locked today</td><td class="n">' + moneyFull(r.tvl_usd) + '</td></tr>'
    + '<tr><td>× Category multiple — median mcap/TVL of ' + r.ratio_comps + ' tokenized ' + esc(catLabel) + ' protocol' + (r.ratio_comps === 1 ? '' : 's') + ', shrunk toward the global median ' + R.model.global_ratio.toFixed(3) + '</td><td class="n">' + mult(r.category_ratio) + '</td></tr>'
    + '<tr><td>× Momentum — ' + esc(momNote) + '</td><td class="n">' + mult(r.momentum_multiplier) + '</td></tr>'
    + '<tr><td>× Maturity — ' + esc(ageNote) + '</td><td class="n">' + mult(r.age_multiplier) + '</td></tr>'
    + '<tr><td>× Breadth — ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ', +' + Math.round(R.model.breadth_per_chain * 100) + '% per extra chain up to six</td><td class="n">' + mult(r.breadth_multiplier) + '</td></tr>'
    + '<tr class="total"><td>Implied value if it launched at category value</td><td class="n">' + moneyFull(r.implied_value_usd) + '</td></tr>'
    + '</tbody></table>'
    + '<p class="check-line">✓ recomputed on this page from the row\'s own inputs: ' + moneyFull(check) + (check === r.implied_value_usd ? ' — matches the board' : ' — differs from the board, trust the board') + '</p>'
    + '<h3>Farm plan — positioning for a possible launch</h3>'
    + '<ol class="steps">' + r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>'
    + '<p class="chain-list" style="margin-top:14px">A plan is positioning, not a promise: ' + esc(r.name) + ' may never launch a token. Amounts are sized to the protocol\'s TVL and its main chain\'s gas, and every step can be skipped — the first two do most of the work.</p>'
    + '</div>';
  const d = $('drawer');
  $('drawerClose').addEventListener('click', () => d.close());
  if (typeof d.showModal === 'function') d.showModal();
}

function renderModel() {
  const m = R.model;
  $('modelPanel').innerHTML = '<h2>How radar-2 prices a protocol with no token</h2>'
    + '<p>The market has already priced hundreds of token launches. Each tokenized protocol in the snapshot is a comparable: its market cap divided by its TVL says what one locked dollar is worth once a token trades. radar-2 takes the <strong>median</strong> of those ratios inside each category — medians ignore the one wild outlier — shrinks categories with few comparables toward the global median of <strong>' + m.global_ratio.toFixed(3) + '</strong> (from ' + m.global_comps + ' tokenized protocols with a market cap), winsorizes every single ratio to [0.02, 5] before it can vote, and never lets a category multiple leave [0.03, 3]. The same function prices every row; no name is special-cased, and tokenized protocols are set aside as comparables, never ranked.</p>'
    + '<p class="formula">implied = TVL × <b>category multiple</b> × <b>momentum</b> × <b>maturity</b> × <b>breadth</b></p>'
    + '<div class="model-grid">'
    + '<div class="model-card"><h3>Category multiple</h3><p>The shrunk median mcap/TVL of the protocol\'s own category. Lending dollars and DEX dollars are not worth the same once tokenized, and the model refuses to pretend they are.</p></div>'
    + '<div class="model-card"><h3>Momentum ×' + '0.82–1.27' + '</h3><p>1 + ' + m.momentum_weight + ' × the 7-day TVL change, clamped to [' + m.momentum_floor + '%, +' + m.momentum_cap + '%]. Growing protocols launch into demand; shrinking ones launch into a headwind. No reported change is neutral.</p></div>'
    + '<div class="model-card"><h3>Maturity ×' + m.maturity_base.toFixed(2) + '–' + (m.maturity_base + m.maturity_range).toFixed(2) + '</h3><p>Rises with days since listing, over ' + m.maturity_days.toLocaleString('en-US') + ' days. A protocol that has run for years with no token has a holder base and a record; a three-week-old one has a chart.</p></div>'
    + '<div class="model-card"><h3>Breadth ×1.00–1.20</h3><p>+' + Math.round(m.breadth_per_chain * 100) + '% for each chain past the first, up to six. Value held on several chains means several communities a launch can reach on day one.</p></div>'
    + '</div>';
}

function init() {
  if (!R || !Array.isArray(R.rows)) {
    document.body.innerHTML = '<main class="wrap"><section class="panel model-panel"><h2>Data file missing</h2><p>window.RADAR was not set: run the entry (node main.ts) so data.js is written beside dashboard/, then reload.</p></section></main>';
    return;
  }
  $('brandTag').textContent = R.model_version;
  $('topMeta').textContent = 'snapshot ' + R.as_of + ' · ' + R.source;
  const total = R.rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const sorted = [...R.rows].sort((a, b) => a.implied_value_usd - b.implied_value_usd);
  const medianImplied = sorted.length ? sorted[Math.floor(sorted.length / 2)].implied_value_usd : 0;
  $('lede').innerHTML = 'The snapshot covers hundreds of protocols; <strong>' + R.board_size + ' of them record no token</strong> and pass the launch screen — every one of the <strong>' + R.watchlist_size + ' watchlist</strong> names plus <strong>' + R.early_size + ' early protocols</strong> below the $' + (R.floor_usd / 1e6) + 'M watchlist floor. radar-2 prices each from the tokenized protocols in its own category and ranks them by implied value. Every row opens a detail view with the full arithmetic and a five-step farm plan with costs and durations.';
  $('stats').innerHTML = [
    ['Protocols ranked', R.board_size, ''],
    ['Watchlist covered', R.watchlist_size + ' / ' + R.watchlist_size, ''],
    ['Early rows found', R.early_size, 'below the floor'],
    ['Tokenized comparables', R.model.global_comps, 'with a market cap'],
    ['Combined implied value', money(total), ''],
    ['Median implied value', money(medianImplied), ''],
  ].map(([k, v, s]) => '<div class="stat"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + (s ? ' <small>' + esc(s) + '</small>' : '') + '</span></div>').join('');
  fillSelect($('fCategory'), [...new Set(R.rows.map((r) => r.category ?? 'Uncategorized'))].sort(), 'All categories');
  const chainCounts = new Map();
  for (const r of R.rows) for (const c of r.chains) chainCounts.set(c, (chainCounts.get(c) ?? 0) + 1);
  fillSelect($('fChain'), [...chainCounts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c), 'All chains');
  $('q').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); render(); });
  $('fCategory').addEventListener('change', (e) => { state.category = e.target.value; render(); });
  $('fChain').addEventListener('change', (e) => { state.chain = e.target.value; render(); });
  $('fTvl').addEventListener('change', (e) => { state.tvl = Number(e.target.value) || 0; render(); });
  const setTab = (tab) => {
    state.tab = tab;
    state.sortKey = tab === 'board' ? 'implied' : 'mcap';
    state.sortDir = -1;
    $('tabBoard').classList.toggle('active', tab === 'board');
    $('tabLive').classList.toggle('active', tab === 'live');
    $('tabBoard').setAttribute('aria-selected', String(tab === 'board'));
    $('tabLive').setAttribute('aria-selected', String(tab === 'live'));
    render();
  };
  $('tabBoard').addEventListener('click', () => setTab('board'));
  $('tabLive').addEventListener('click', () => setTab('live'));
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('q') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('q').focus(); }
  });
  renderModel();
  $('foot').innerHTML = '<p>Source: ' + esc(R.source) + ' snapshot as of ' + esc(R.as_of) + '. A protocol "records no token" when the snapshot carries no market cap, no CoinGecko id and no symbol for it; tokenized protocols are shown only as comparables.</p>'
    + '<p>Implied values are a model\'s estimate of what a launch would be worth at category value — not a prediction that a launch happens, and not financial advice. Farm plans describe positioning a real user would do anyway; do them only with funds you can leave parked.</p>';
  render();
}

document.addEventListener('DOMContentLoaded', init);
