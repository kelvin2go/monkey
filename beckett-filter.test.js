// Unit tests for beckett-filter pure parsers
// Run: node beckett-filter.test.js

// ── Inline the pure functions under test ──────────────────────────────────────
const RC_RE = /\s*\bRC\b\s*/g;
const ODDS_RE = /(\w+)\s*[–\-]\s*1:([0-9,]+)/g;
const ID_CARD_RE = /([A-Z]+-[A-Z0-9]+)\s+(.+?)(?=\s*[A-Z]+-[A-Z0-9]+\s|$)/g;
const NUM_CARD_RE = /(\d+)\s+([A-Z].+?)(?=\s*\d+\s+[A-Z]|\s*$)/g;
const SERIAL_JAM_RE = /\/(\d+?)(\d)(?=\s+[A-Z])/g;

function parseOdds(rawText) {
  const odds = {};
  const line = rawText.match(/(?:Hobby|Jumbo|Value|Mega)[^\n]+/i)?.[0] || '';
  let m;
  ODDS_RE.lastIndex = 0;
  while ((m = ODDS_RE.exec(line)) !== null) {
    const v = parseInt(m[2].replace(/,/g, ''), 10);
    if (isFinite(v)) odds[m[1]] = v;
  }
  return odds;
}

function parseIdCards(rawText) {
  const cards = [];
  for (const line of rawText.split(/\n/)) {
    ID_CARD_RE.lastIndex = 0;
    let m;
    while ((m = ID_CARD_RE.exec(line.trim())) !== null) {
      const full = m[2].replace(RC_RE, '').replace(/\s*\/\d+\s*$/, '').trim();
      const lastComma = full.lastIndexOf(', ');
      cards.push({
        id: m[1],
        player: lastComma > 0 ? full.slice(0, lastComma) : full,
        team: lastComma > 0 ? full.slice(lastComma + 2) : '',
      });
    }
  }
  return cards;
}

function parseNumberedCards(rawText) {
  const cards = [];
  for (const line of rawText.split(/\n/)) {
    const cleaned = line.trim().replace(SERIAL_JAM_RE, ' $2');
    NUM_CARD_RE.lastIndex = 0;
    let m;
    while ((m = NUM_CARD_RE.exec(cleaned)) !== null) {
      const full = m[2].replace(RC_RE, '').replace(/\s*\/\d+\s*$/, '').trim();
      const lastComma = full.lastIndexOf(', ');
      cards.push({
        id: m[1],
        player: lastComma > 0 ? full.slice(0, lastComma) : full,
        team:   lastComma > 0 ? full.slice(lastComma + 2) : '',
      });
    }
  }
  return cards;
}

function parseCards(rawText) {
  const cards = parseIdCards(rawText);
  return cards.length > 0 ? cards : parseNumberedCards(rawText);
}

function hitRate(oddsPerPack, packsPerBox) {
  if (!oddsPerPack || !packsPerBox) return null;
  const rate = packsPerBox / oddsPerPack;
  if (rate >= 1) return `~${rate.toFixed(1)}x / box`;
  return `1 per ${Math.round(1 / rate)} boxes`;
}

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function assert(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}\n    expected: ${e}\n    got:      ${a}`);
    failed++;
  }
}

// ── parseOdds ─────────────────────────────────────────────────────────────────
console.log('\nparseOdds');
assert('hyphen separator',
  parseOdds('Hobby - 1:28 packs; Jumbo - 1:6 packs'),
  { Hobby: 28, Jumbo: 6 });

assert('en-dash separator',
  parseOdds('Hobby – 1:28; Jumbo – 1:6'),
  { Hobby: 28, Jumbo: 6 });

assert('comma in number',
  parseOdds('Value – 1:1,402'),
  { Value: 1402 });

assert('missing line returns empty',
  parseOdds('No odds here'),
  {});

assert('all four box types',
  parseOdds('Hobby – 1:28; Jumbo – 1:6; Value – 1:1,402; Mega – 1:425'),
  { Hobby: 28, Jumbo: 6, Value: 1402, Mega: 425 });

// ── parseIdCards — numeric suffix ─────────────────────────────────────────────
console.log('\nparseIdCards — numeric suffix');
assert('single card',
  parseIdCards('AB-1 Anthony Edwards, Minnesota Timberwolves'),
  [{ id: 'AB-1', player: 'Anthony Edwards', team: 'Minnesota Timberwolves' }]);

assert('concatenated without separator (the \\b bug regression)',
  parseIdCards('L-1 Anthony Edwards, Minnesota TimberwolvesL-2 Ja Morant, Memphis Grizzlies'),
  [
    { id: 'L-1', player: 'Anthony Edwards', team: 'Minnesota Timberwolves' },
    { id: 'L-2', player: 'Ja Morant', team: 'Memphis Grizzlies' },
  ]);

assert('RC suffix stripped from player field, not from ID',
  parseIdCards('AB-12 Chet Holmgren RC, Oklahoma City Thunder'),
  [{ id: 'AB-12', player: 'Chet Holmgren', team: 'Oklahoma City Thunder' }]);

assert('no team',
  parseIdCards('SC-7 LeBron James'),
  [{ id: 'SC-7', player: 'LeBron James', team: '' }]);

// ── parseIdCards — letter suffix (the RCA-AB bug regression) ─────────────────
console.log('\nparseIdCards — letter suffix');
assert('letter-suffix single',
  parseIdCards('RCA-AB Ace Bailey, Utah Jazz'),
  [{ id: 'RCA-AB', player: 'Ace Bailey', team: 'Utah Jazz' }]);

assert('letter-suffix concatenated',
  parseIdCards('RCA-AB Ace Bailey, Utah JazzRCA-AM Alijah Martin, Toronto Raptors'),
  [
    { id: 'RCA-AB', player: 'Ace Bailey', team: 'Utah Jazz' },
    { id: 'RCA-AM', player: 'Alijah Martin', team: 'Toronto Raptors' },
  ]);

assert('mixed-length suffix (ATH)',
  parseIdCards('RCA-ATH Adou Thiero, Los Angeles Lakers'),
  [{ id: 'RCA-ATH', player: 'Adou Thiero', team: 'Los Angeles Lakers' }]);

assert('trailing serial stripped from team',
  parseIdCards('FM-AB Ace Bailey, Utah Jazz /10FM-AT Adou Thiero, Los Angeles Lakers /10'),
  [
    { id: 'FM-AB', player: 'Ace Bailey', team: 'Utah Jazz' },
    { id: 'FM-AT', player: 'Adou Thiero', team: 'Los Angeles Lakers' },
  ]);

// ── parseNumberedCards ────────────────────────────────────────────────────────
console.log('\nparseNumberedCards');
assert('two consecutive no team',
  parseNumberedCards('1 Anthony Edwards2 Ja Morant'),
  [
    { id: '1', player: 'Anthony Edwards', team: '' },
    { id: '2', player: 'Ja Morant', team: '' },
  ]);

assert('RC stripped',
  parseNumberedCards('5 Victor Wembanyama RC'),
  [{ id: '5', player: 'Victor Wembanyama', team: '' }]);

assert('with team (no serial)',
  parseNumberedCards('45 Norchad Omier, Cleveland Cavaliers46 Zeke Mayo, Washington Wizards'),
  [
    { id: '45', player: 'Norchad Omier', team: 'Cleveland Cavaliers' },
    { id: '46', player: 'Zeke Mayo', team: 'Washington Wizards' },
  ]);

assert('serial number jammed against next card number',
  parseNumberedCards('1 VJ Edgecombe, Philadelphia 76ers /992 Tre Johnson III, Washington Wizards /993 Jeremiah Fears, New Orleans Pelicans /99'),
  [
    { id: '1', player: 'VJ Edgecombe', team: 'Philadelphia 76ers' },
    { id: '2', player: 'Tre Johnson III', team: 'Washington Wizards' },
    { id: '3', player: 'Jeremiah Fears', team: 'New Orleans Pelicans' },
  ]);

assert('trailing serial on last entry stripped',
  parseNumberedCards('1 Ace Bailey, Utah Jazz /99'),
  [{ id: '1', player: 'Ace Bailey', team: 'Utah Jazz' }]);

// ── parseCards fallback logic ─────────────────────────────────────────────────
console.log('\nparseCards fallback');
assert('uses ID parser when IDs present',
  parseCards('AB-1 Edwards, Wolves').length > 0 &&
  parseCards('AB-1 Edwards, Wolves')[0].id === 'AB-1',
  true);

assert('falls back to numbered when no ID codes',
  parseCards('1 Edwards2 Morant').map(c => c.id),
  ['1', '2']);

assert('numbered fallback does not run when ID parser succeeds',
  parseCards('AB-1 Edwards, WolvesAB-2 Morant, Grizzlies').length,
  2);

// ── hitRate ───────────────────────────────────────────────────────────────────
console.log('\nhitRate');
assert('zero odds → null', hitRate(0, 24), null);
assert('zero packs → null', hitRate(28, 0), null);
assert('rate >= 1 shows multiplier', hitRate(6, 24), '~4.0x / box');
assert('rate < 1 shows per-box', hitRate(100, 24), '1 per 4 boxes');
assert('rate exactly 1', hitRate(24, 24), '~1.0x / box');

// ── autocomplete filtering ────────────────────────────────────────────────────
console.log('\nautocomplete filtering');

function filterAutocomplete(allPlayers, query, tags) {
  if (!query) return [];
  const lq = query.toLowerCase();
  return allPlayers.filter(p => p.toLowerCase().includes(lq) && !tags.includes(p)).slice(0, 12);
}

const PLAYERS = ['Anthony Edwards', 'Ace Bailey', 'Queen James', 'LeBron James', 'Jayson Tatum'];

assert('basic match "queen"',
  filterAutocomplete(PLAYERS, 'queen', []),
  ['Queen James']);

assert('case-insensitive "QUEEN"',
  filterAutocomplete(PLAYERS, 'QUEEN', []),
  ['Queen James']);

assert('mid-name match "james"',
  filterAutocomplete(PLAYERS, 'james', []),
  ['Queen James', 'LeBron James']);

assert('empty query returns nothing',
  filterAutocomplete(PLAYERS, '', []),
  []);

assert('already-tagged player excluded',
  filterAutocomplete(PLAYERS, 'james', ['Queen James']),
  ['LeBron James']);

assert('multiple tags excluded',
  filterAutocomplete(PLAYERS, 'james', ['Queen James', 'LeBron James']),
  []);

assert('no match returns empty',
  filterAutocomplete(PLAYERS, 'curry', []),
  []);

// ── buildBreakdownData ────────────────────────────────────────────────────────
console.log('\nbuildBreakdownData');

function buildBreakdownData(sourceSections) {
  const tabCols = [...new Set(sourceSections.map(s => s.tabName))];
  const playerMap = {};
  sourceSections.forEach((s) => {
    s.cards.forEach((c) => {
      if (!c.player) return;
      if (!playerMap[c.player]) playerMap[c.player] = {};
      playerMap[c.player][s.tabName] = (playerMap[c.player][s.tabName] || 0) + 1;
    });
  });
  return { tabCols, playerMap };
}

const fakeSections = [
  { tabName: 'Autographs', cards: [
    { player: 'Anthony Edwards', team: 'Timberwolves' },
    { player: 'Ace Bailey', team: 'Jazz' },
    { player: 'Anthony Edwards', team: 'Timberwolves' },
  ]},
  { tabName: 'Inserts', cards: [
    { player: 'Anthony Edwards', team: 'Timberwolves' },
    { player: 'LeBron James', team: 'Lakers' },
  ]},
];

const bd = buildBreakdownData(fakeSections);

assert('tabCols from sections',
  bd.tabCols,
  ['Autographs', 'Inserts']);

assert('player count Auto',
  bd.playerMap['Anthony Edwards']['Autographs'],
  2);

assert('player count Ins',
  bd.playerMap['Anthony Edwards']['Inserts'],
  1);

assert('player with only one tab',
  bd.playerMap['Ace Bailey'],
  { Autographs: 1 });

assert('player absent from tab is undefined (not 0)',
  bd.playerMap['LeBron James']['Autographs'],
  undefined);

// ── serializeConfig / deserializeConfig ──────────────────────────────────────
console.log('\nserializeConfig / deserializeConfig');

function serializeConfig(state) {
  return {
    playerTags:   [...state.playerTags],
    recentPlayers:[...state.recentPlayers],
    boxType:      state.boxType,
    team:         state.team,
    tab:          state.tab,
    type:         state.type,
    bdPlayerTags: [...state.bdPlayerTags.entries()],
    bdSortCol:    state.bdSortCol,
    bdSortDir:    state.bdSortDir,
  };
}

function deserializeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    playerTags:   Array.isArray(raw.playerTags)    ? raw.playerTags    : [],
    recentPlayers:Array.isArray(raw.recentPlayers)  ? raw.recentPlayers : [],
    boxType:      typeof raw.boxType === 'string'   ? raw.boxType       : null,
    team:         raw.team  || '',
    tab:          raw.tab   || '',
    type:         raw.type  || '',
    bdPlayerTags: new Map(Array.isArray(raw.bdPlayerTags) ? raw.bdPlayerTags : []),
    bdSortCol:    raw.bdSortCol !== undefined ? raw.bdSortCol : null,
    bdSortDir:    typeof raw.bdSortDir === 'number' ? raw.bdSortDir : 1,
  };
}

const fullState = {
  playerTags:    ['Ace Bailey', 'LeBron James'],
  recentPlayers: ['Ace Bailey', 'Ja Morant'],
  boxType:       'Value',
  team:          'Lakers',
  tab:           'Autographs',
  type:          'Autographs::Rookie Auto',
  bdPlayerTags:  new Map([['Ace Bailey', 2], ['Ja Morant', 0]]),
  bdSortCol:     'total',
  bdSortDir:     -1,
};

const serialized = serializeConfig(fullState);
const roundtrip  = deserializeConfig(JSON.parse(JSON.stringify(serialized)));

assert('roundtrip playerTags',
  roundtrip.playerTags,
  ['Ace Bailey', 'LeBron James']);

assert('roundtrip recentPlayers',
  roundtrip.recentPlayers,
  ['Ace Bailey', 'Ja Morant']);

assert('roundtrip boxType',
  roundtrip.boxType,
  'Value');

assert('roundtrip team/tab/type',
  [roundtrip.team, roundtrip.tab, roundtrip.type],
  ['Lakers', 'Autographs', 'Autographs::Rookie Auto']);

assert('roundtrip bdPlayerTags as Map',
  roundtrip.bdPlayerTags instanceof Map &&
  roundtrip.bdPlayerTags.get('Ace Bailey') === 2 &&
  roundtrip.bdPlayerTags.get('Ja Morant') === 0,
  true);

assert('roundtrip bdSortCol + bdSortDir',
  [roundtrip.bdSortCol, roundtrip.bdSortDir],
  ['total', -1]);

// bdPlayerTags serialized as entries array (JSON-safe)
assert('serialized bdPlayerTags is array',
  Array.isArray(serialized.bdPlayerTags),
  true);

assert('serialized bdPlayerTags entries',
  serialized.bdPlayerTags,
  [['Ace Bailey', 2], ['Ja Morant', 0]]);

// deserializeConfig handles missing/null gracefully
const empty = deserializeConfig(null);
assert('null input returns null',
  empty,
  null);

const partial = deserializeConfig({ boxType: 'Hobby' });
assert('partial: playerTags defaults to []',
  partial.playerTags,
  []);

assert('partial: bdPlayerTags defaults to empty Map',
  partial.bdPlayerTags instanceof Map && partial.bdPlayerTags.size === 0,
  true);

assert('partial: bdSortDir defaults to 1',
  partial.bdSortDir,
  1);

assert('partial: boxType preserved',
  partial.boxType,
  'Hobby');

assert('partial: missing bdSortCol defaults to null',
  partial.bdSortCol,
  null);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
