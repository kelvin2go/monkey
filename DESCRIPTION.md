# Beckett Card Filter

A Tampermonkey userscript that turns any Beckett checklist page into a filterable, analyzable card database — with a persistent sidebar, player tracking, box-type odds, and breakdown analytics.

**Install:** [beckett-filter.user.js](beckett-filter.user.js)  
**Matches:** `https://www.beckett.com/news/*`  
**Tests:** `node beckett-filter.test.js` (48 tests)

---

## Features

### Sidebar
- Fixed left panel — pushes page content right, never overlaps
- Draggable width (180–600 px)
- Two views: **📋 Results** and **📊 Breakdown**

### Results view

| Filter | What it does |
|--------|-------------|
| **Box type** | Hobby / Jumbo / Value / Mega — filters sets to those with matching pack odds |
| **👤 Player** | Tag-based multi-select with live autocomplete; add as many players as you want |
| **🏀 Team** | Single-select dropdown, auto-populated from parsed cards |
| **📂 Tab** | Filter to one tab — Autographs, Inserts, Memorabilia, etc. |
| **🎴 Type** | Filter to a specific set within a tab |

Each card row shows ID, player name, and team. Click a player name in any result to instantly add them as a filter tag.

**Hit rate** is calculated per set when pack odds are present (e.g. `~4.0x / box` or `1 per 3 boxes`).

### Player tag system
- Search → click (or press Enter) to add a player chip
- Multi-player: add as many chips as needed, results show cards matching any tagged player
- **Recent history:** last 5 used players appear as greyed chips — click to re-activate without re-searching
- Click **×** on any chip to remove it

### Breakdown view
- Player × card-type matrix with columns for each tab (Auto / Ins / Mem) and a **Total** column in gold
- **Click any column header** to sort: counts sort high→low, Player sorts A→Z; click again to reverse
- **Click a player name** → jumps to Results filtered to that player
- **Click a count cell** → jumps to Results filtered to that player and tab

#### Colored player tags (Breakdown)
- Search and select players to pin them at the top of the breakdown table
- Each gets an auto-assigned color from an 8-color palette
- Click a chip to cycle through colors — the row background and name text update to match
- Tagged players always stay pinned above untagged rows regardless of sort

#### Snapshot & Compare
- **📸 Snapshot** captures the current breakdown with a label (box type · tab · players)
- Take a second snapshot to automatically enter compare mode
- Side-by-side diff: Δ+/- shown per cell in green (gain) / red (loss); unchanged rows dimmed

### Saved defaults
- **💾 Set default** saves your entire filter state to `localStorage`
- Restored automatically every time you open the page — no re-selecting needed
- Saves: box type, player tags, recent history, team / tab / type dropdowns, breakdown tags (with colors), sort column and direction
- **✕ Clear** resets the active session without erasing the saved default
- Click **💾 Set default** again at any time to update it

---

## Parsing

The script parses Beckett's advgb WordPress tab structure (`.advgb-tab-body-container`) and falls back to generic content containers if needed.

Card formats supported:
- Alphanumeric IDs: `RCA-AB Ace Bailey, Utah Jazz`
- Numeric IDs: `SC-7 LeBron James, Lakers`
- Numbered lists: `1 Anthony Edwards2 Ja Morant`
- RC suffix stripping: `Chet Holmgren RC` → `Chet Holmgren`

Skipped tabs: Base, Base Set, Team Sets, Full Checklist, Master.

---

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser
2. Click [beckett-filter.user.js](beckett-filter.user.js) → **Raw** → Tampermonkey will prompt to install
3. Auto-updates are handled via `@updateURL` / `@downloadURL` pointing to this repo

---

## Development

```bash
# Run unit tests (no browser required)
node beckett-filter.test.js

# 48 tests covering:
# - parseOdds, parseIdCards, parseNumberedCards, parseCards
# - hitRate
# - filterAutocomplete
# - buildBreakdownData
# - serializeConfig / deserializeConfig (config round-trip, partial inputs, null guard)
```

The pure functions (`parseOdds`, `parseCards`, `serializeConfig`, `deserializeConfig`, etc.) are kept free of DOM dependencies so they can be tested directly in Node.

---

## Version history highlights

| Version | Change |
|---------|--------|
| 4.3.0 | `serializeConfig`/`deserializeConfig` extracted + 14 unit tests |
| 4.2.9 | Fix box button restore (matched by `textContent`, not missing `data-type`) |
| 4.2.8 | Fix `loadDefault` call order — bd state vars must exist first |
| 4.2.7 | Save filter state as default via `localStorage` |
| 4.2.6 | Recent player history — last 5, greyed chips, click to re-activate |
| 4.2.5 | Sortable breakdown columns with gold active indicator |
| 4.2.4 | Colored player tags in breakdown — 8-color palette, click to cycle |
