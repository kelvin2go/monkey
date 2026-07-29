// ==UserScript==
// @name         Beckett Card Filter
// @namespace    https://github.com/kelvin2go/monkey
// @version      4.4.6
// @description  Collapsible sidebar — filter by box, player, team, tab, and card type
// @author       kelvin2go
// @license      MIT
// @match        https://www.beckett.com/news/*
// @updateURL    https://raw.githubusercontent.com/kelvin2go/monkey/main/beckett-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/kelvin2go/monkey/main/beckett-filter.user.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function getText(el) {
    return el ? (el.innerText || el.textContent || '') : '';
  }

  // ─── Parse packs-per-box ──────────────────────────────────────────────────────
  function parseBoxPacks() {
    const text = getText(document.body);
    const m = text.match(/Packs per box[:\s]+([^\n]+)/i);
    if (!m) return {};
    const result = {};
    m[1].replace(/(\w+)\s*[–\-]\s*(\d+)/g, (_, type, n) => {
      result[type] = parseInt(n, 10);
    });
    return result;
  }

  // ─── Constants ────────────────────────────────────────────────────────────────
  const SKIP_TABS = /^(base\b|base set|team sets?|full checklist|master)$/i;
  const SKIP_TYPE = /(^|\s)(team sets?)\b|^(base set|base\b|master checklist|full checklist)/i;
  const RC_RE = /\s*\bRC\b\s*/g;
  const ODDS_RE = /(\w+)\s*[–\-]\s*1:([0-9,]+)/g;
  const ID_CARD_RE = /([A-Z]+-[A-Z0-9]+)\s+(.+?)(?=\s*[A-Z]+-[A-Z0-9]+\s|$)/g;
  const NUM_CARD_RE = /(\d+)\s+([A-Z].+?)(?=\s*\d+\s+[A-Z]|\s*$)/g;
  const SERIAL_JAM_RE = /\/(\d+?)(\d)(?=\s+[A-Z])/g; // '/99' jammed against next card number

  function findAllTabBodies() {
    const results = [];

    const containers = document.querySelectorAll('.advgb-tab-body-container');
    if (containers.length > 0) {
      containers.forEach((container) => {
        const header = container.querySelector('.advgb-tab-body-header');
        const body = container.querySelector('.advgb-tab-body');
        if (!body) return;
        const tabName = getText(header).trim();
        if (!tabName || SKIP_TABS.test(tabName)) return;
        results.push({ tabName, body });
      });
      if (results.length > 0) return results;
    }

    // Fallback: advgb-tab-body with card content
    document.querySelectorAll('.advgb-tab-body').forEach((body) => {
      const parent = body.parentElement;
      const label = parent && parent.querySelector('[class*="header"], [class*="title"], [class*="label"]');
      const tabName = label ? getText(label).trim() : '';
      if (SKIP_TABS.test(tabName)) return;
      if (/[A-Z]+-[A-Z0-9]+|\d+\s+[A-Z]/.test(body.textContent)) {
        results.push({ tabName: tabName || 'Inserts', body });
      }
    });
    if (results.length > 0) return results;

    const article = document.querySelector('.entry-content, article, main, [class*="post-content"]');
    if (article) results.push({ tabName: 'Inserts', body: article });
    return results;
  }

  // ─── Pure parsers (testable without DOM) ─────────────────────────────────────
  function parseOdds(rawText) {
    const odds = {};
    // scan all matching lines, not just the first
    for (const line of rawText.split(/\n/)) {
      if (!/Hobby|Jumbo|Value|Mega/i.test(line)) continue;
      ODDS_RE.lastIndex = 0;
      let m;
      while ((m = ODDS_RE.exec(line)) !== null) {
        const v = parseInt(m[2].replace(/,/g, ''), 10);
        // Strip leading garbage jammed against the type word (e.g. "cardsHobby" → "Hobby")
        // when a card count like "20 cards" runs into the type name without a separator.
        const typeMatch = m[1].match(/(Hobby|Jumbo|Value|Mega)$/i);
        const key = typeMatch ? typeMatch[1] : m[1];
        if (isFinite(v) && !odds[key]) odds[key] = v;
      }
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
      // Split serial numbers jammed against next card number: '/992 Tre' → ' 2 Tre'
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

  // ─── Parse sections ───────────────────────────────────────────────────────────
  const SKIP_HEADING = /^(checklist|shop for|related:|advertisement)/i;

  function parseSections(container, tabName) {
    const sections = [];
    const headings = container.querySelectorAll('h2, h3, h4, strong');

    headings.forEach((h) => {
      const title = h.textContent.trim();
      if (!title || title.length > 100 || SKIP_HEADING.test(title)) return;

      let el = h.tagName === 'STRONG' ? h.closest('p')?.nextElementSibling : h.nextElementSibling;
      const chunks = [];
      let safety = 0;
      while (el && safety++ < 200) {
        if (['H2', 'H3', 'H4'].includes(el.tagName)) break;
        chunks.push(getText(el));
        el = el.nextElementSibling;
      }
      const rawText = chunks.join('\n');
      const cards = parseCards(rawText);
      if (cards.length === 0) return;
      sections.push({ title, tabName: tabName || 'Inserts', odds: parseOdds(rawText), cards });
    });

    return sections;
  }

  // ─── Hit rate ─────────────────────────────────────────────────────────────────
  function hitRate(oddsPerPack, packsPerBox) {
    if (!oddsPerPack || !packsPerBox) return null;
    const rate = packsPerBox / oddsPerPack;
    if (rate >= 1) return `~${rate.toFixed(1)}x / box`;
    return `1 per ${Math.round(1 / rate)} boxes`;
  }

  // ─── Styles ───────────────────────────────────────────────────────────────────
  function injectStyles() {
    GM_addStyle(`
      #bk-toggle {
        position: fixed;
        top: 50%;
        left: 0;
        transform: translateY(-50%);
        z-index: 10000;
        background: #e63c14;
        color: #fff;
        border: none;
        border-radius: 0 6px 6px 0;
        padding: 10px 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
        writing-mode: vertical-rl;
        letter-spacing: 1px;
        box-shadow: 2px 0 8px rgba(0,0,0,0.5);
        transition: left 0.25s;
      }
      #bk-toggle.open { left: var(--bk-w, 302px); }
      #bk-sidebar {
        position: fixed;
        top: 0;
        left: calc(-1 * var(--bk-w, 302px));
        width: var(--bk-w, 302px);
        height: 100vh;
        z-index: 9999;
        background: #1c1c1e;
        border-right: 1px solid #3a3a3c;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        color: #e0e0e0;
        transition: left 0.25s;
        box-shadow: 6px 0 24px rgba(0,0,0,0.6);
      }
      #bk-sidebar.open { left: 0; }
      #bk-sidebar.dragging { transition: none; }
      #bk-resize {
        position: absolute;
        top: 0;
        right: -4px;
        width: 8px;
        height: 100%;
        cursor: ew-resize;
        z-index: 10001;
      }
      #bk-resize:hover, #bk-resize.active { background: rgba(230,60,20,0.35); }
      #bk-sidebar-head {
        padding: 14px 14px 12px;
        border-bottom: 1px solid #2c2c2e;
        flex-shrink: 0;
        background: #232325;
        overflow: hidden;
        min-width: 0;
      }
      #bk-sidebar-head h2 {
        margin: 0 0 10px;
        font-size: 11px;
        font-weight: 700;
        color: #e63c14;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
      .bk-box-row {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
        margin-bottom: 10px;
      }
      .bk-box-btn {
        padding: 4px 12px;
        border-radius: 20px;
        border: 1px solid #48484a;
        background: #2c2c2e;
        color: #aeaeb2;
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        transition: all 0.15s;
      }
      .bk-box-btn:hover { border-color: #e63c14; color: #ff6b47; background: #2c1a15; }
      .bk-box-btn.active { background: #e63c14; border-color: #e63c14; color: #fff; }
      #bk-filters {
        display: flex;
        flex-direction: column;
        gap: 7px;
        min-width: 0;
      }
      .bk-filter-row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        overflow: hidden;
      }
      .bk-filter-label {
        font-size: 11px;
        font-weight: 500;
        color: #8e8e93;
        width: 58px;
        flex-shrink: 0;
      }
      #bk-search {
        flex: 1;
        background: #2c2c2e;
        border: 1px solid #48484a;
        border-radius: 6px;
        color: #f2f2f7;
        font-size: 12px;
        padding: 5px 9px;
        outline: none;
        transition: border-color 0.15s;
      }
      #bk-search:focus { border-color: #e63c14; background: #313133; }
      #bk-search::placeholder { color: #636366; }
      .bk-select {
        flex: 1;
        min-width: 0;
        box-sizing: border-box;
        background: #2c2c2e;
        border: 1px solid #48484a;
        border-radius: 6px;
        color: #f2f2f7;
        font-size: 12px;
        padding: 5px 6px;
        outline: none;
        cursor: pointer;
        width: 100%;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: border-color 0.15s;
      }
      .bk-select:focus { border-color: #e63c14; }
      #bk-filter-actions {
        display: flex;
        gap: 4px;
        margin-top: 1px;
      }
      #bk-clear, #bk-save-default {
        flex: 1;
        background: #2c2c2e;
        border: 1px solid #48484a;
        border-radius: 6px;
        color: #8e8e93;
        font-size: 11px;
        padding: 5px;
        cursor: pointer;
        transition: all 0.15s;
      }
      #bk-clear:hover { border-color: #8e8e93; color: #f2f2f7; background: #3a3a3c; }
      #bk-save-default:hover { border-color: #ffc130; color: #ffc130; background: #2a2200; }
      #bk-save-default.has-default { border-color: #a07000; color: #ffc130; }
      #bk-summary {
        font-size: 11px;
        color: #636366;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #2c2c2e;
        line-height: 1.5;
      }
      #bk-results {
        flex: 1;
        overflow-y: auto;
        padding: 12px 14px 24px;
      }
      #bk-results::-webkit-scrollbar { width: 4px; }
      #bk-results::-webkit-scrollbar-thumb { background: #48484a; border-radius: 2px; }
      .bk-set {
        margin-bottom: 18px;
        border-left: 2px solid #e63c14;
        padding-left: 10px;
      }
      .bk-set-title {
        font-size: 13px;
        font-weight: 600;
        color: #f2f2f7;
        margin-bottom: 2px;
        display: flex;
        align-items: center;
        gap: 5px;
        flex-wrap: wrap;
        line-height: 1.4;
      }
      .bk-tab-tag {
        font-size: 10px;
        font-weight: 700;
        border-radius: 3px;
        padding: 2px 6px;
        flex-shrink: 0;
        letter-spacing: 0.3px;
        text-transform: uppercase;
      }
      .bk-tab-tag-autographs { background: #2d2200; border: 1px solid #a07000; color: #ffc130; }
      .bk-tab-tag-inserts    { background: #0d1f35; border: 1px solid #1e5fa0; color: #5aadff; }
      .bk-tab-tag-memorabilia{ background: #1f0d2a; border: 1px solid #7a30b0; color: #c97dff; }
      .bk-tab-tag-other      { background: #0d2a1a; border: 1px solid #1f7a4a; color: #4dcc88; }
      .bk-hit-rate {
        background: #1c2e1c;
        border: 1px solid #2d5a2d;
        border-radius: 3px;
        padding: 1px 6px;
        font-size: 10px;
        font-weight: 600;
        color: #5ac85a;
        flex-shrink: 0;
      }
      .bk-set-meta {
        font-size: 11px;
        color: #8e8e93;
        margin-bottom: 6px;
      }
      .bk-cards {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .bk-card {
        font-size: 12px;
        color: #c7c7cc;
        padding: 3px 0;
        border-bottom: 1px solid #2c2c2e;
        display: flex;
        gap: 6px;
        align-items: baseline;
      }
      .bk-card.highlight { color: #f2f2f7; }
      .bk-card-id { color: #636366; font-size: 11px; flex-shrink: 0; min-width: 36px; font-variant-numeric: tabular-nums; }
      .bk-card-team { color: #8e8e93; font-size: 11px; margin-left: auto; padding-left: 4px; }
      .bk-bd-table td.clickable:hover { color: #ff8c6e; text-decoration: underline; }
      .bk-card span[title]:hover { color: #ff8c6e; }
      .bk-card span[title]:hover::after { content: ' ›'; color: #e63c14; font-weight: 700; }
      .bk-bd-table td:first-child[title]:hover::after { content: ' ↗'; font-size: 10px; color: #e63c14; }
      .bk-empty { color: #636366; font-style: italic; font-size: 12px; padding: 16px 0; text-align: center; }
      #bk-player-box {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      #bk-player-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .bk-player-tag {
        display: flex;
        align-items: center;
        gap: 3px;
        background: #3a2218;
        border: 1px solid #e63c14;
        border-radius: 12px;
        padding: 2px 8px 2px 8px;
        font-size: 11px;
        color: #ff8c6e;
        font-weight: 600;
        white-space: nowrap;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bk-player-tag button {
        background: none;
        border: none;
        color: #e63c14;
        cursor: pointer;
        font-size: 12px;
        padding: 0 0 0 2px;
        line-height: 1;
        flex-shrink: 0;
      }
      .bk-recent-tag {
        background: #1e1e1e;
        border-color: #48484a;
        color: #636366;
        cursor: pointer;
        opacity: 0.75;
      }
      .bk-recent-tag:hover {
        border-color: #888;
        color: #aaa;
        opacity: 1;
      }
      #bk-player-input-wrap { position: relative; }
      #bk-search {
        width: 100%;
        box-sizing: border-box;
        background: #2c2c2e;
        border: 1px solid #48484a;
        border-radius: 6px;
        color: #f2f2f7;
        font-size: 12px;
        padding: 5px 9px;
        outline: none;
        transition: border-color 0.15s;
      }
      #bk-search:focus { border-color: #e63c14; background: #313133; }
      #bk-search::placeholder { color: #636366; }
      #bk-autocomplete {
        position: fixed;
        background: #2c2c2e;
        border: 1px solid #48484a;
        border-radius: 6px;
        z-index: 10002;
        max-height: 160px;
        overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      }
      #bk-autocomplete:empty { display: none; }
      .bk-ac-item {
        padding: 6px 10px;
        font-size: 12px;
        color: #e0e0e0;
        cursor: pointer;
        border-bottom: 1px solid #3a3a3c;
      }
      .bk-ac-item:last-child { border-bottom: none; }
      .bk-ac-item:hover, .bk-ac-item.active { background: #3a3a3c; color: #fff; }
      .bk-ac-item em { color: #e63c14; font-style: normal; font-weight: 700; }
      #bk-view-tabs {
        display: flex;
        gap: 0;
        margin-bottom: 10px;
        border-radius: 6px;
        overflow: hidden;
        border: 1px solid #3a3a3c;
      }
      .bk-view-tab {
        flex: 1;
        padding: 5px 0;
        background: #2c2c2e;
        border: none;
        color: #8e8e93;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        transition: background 0.15s, color 0.15s;
      }
      .bk-view-tab:not(:last-child) { border-right: 1px solid #3a3a3c; }
      .bk-view-tab.active { background: #e63c14; color: #fff; }
      #bk-breakdown-search {
        width: 100%;
        box-sizing: border-box;
        background: #2c2c2e;
        border: 1px solid #48484a;
        border-radius: 6px;
        color: #f2f2f7;
        font-size: 12px;
        padding: 5px 9px;
        outline: none;
        margin-bottom: 8px;
        transition: border-color 0.15s;
      }
      #bk-breakdown-search:focus { border-color: #e63c14; }
      #bk-breakdown-search::placeholder { color: #636366; }
      #bk-breakdown-area {
        flex: 1;
        overflow-y: auto;
        padding: 10px 14px 24px;
        display: none;
      }
      #bk-breakdown-area.active { display: flex; flex-direction: column; }
      #bk-breakdown-area::-webkit-scrollbar { width: 4px; }
      #bk-breakdown-area::-webkit-scrollbar-thumb { background: #48484a; border-radius: 2px; }
      .bk-bd-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .bk-bd-table th {
        text-align: left; font-size: 10px; font-weight: 700; color: #8e8e93;
        text-transform: uppercase; letter-spacing: 0.5px;
        padding: 4px 6px; border-bottom: 1px solid #3a3a3c; white-space: nowrap;
      }
      .bk-bd-table th:not(:first-child) { text-align: center; }
      .bk-bd-table td { padding: 4px 6px; border-bottom: 1px solid #2c2c2e; color: #c7c7cc; }
      .bk-bd-table td:not(:first-child) { text-align: center; color: #8e8e93; }
      .bk-bd-table td.has-val { color: #f2f2f7; font-weight: 600; }
      .bk-bd-actions {
        display: flex; gap: 6px; margin-bottom: 8px; align-items: center; flex-wrap: wrap;
      }
      #bk-snap-btn {
        background: #1c3a1c; border: 1px solid #2d5a2d; color: #5ac85a;
        border-radius: 6px; font-size: 11px; font-weight: 600;
        padding: 5px 10px; cursor: pointer; transition: all 0.15s;
      }
      #bk-snap-btn:hover { background: #2d5a2d; color: #7ddd7d; }
      #bk-compare-btn {
        background: #1c2a3a; border: 1px solid #2d4a6a; color: #5aaeff;
        border-radius: 6px; font-size: 11px; font-weight: 600;
        padding: 5px 10px; cursor: pointer; transition: all 0.15s;
        display: none;
      }
      #bk-compare-btn:hover { background: #2d4a6a; color: #7dc3ff; }
      .bk-snap-label { font-size: 10px; color: #636366; flex: 1; }
      #bk-compare-selects {
        display: none; gap: 6px; margin-bottom: 8px; align-items: center;
      }
      #bk-compare-selects.active { display: flex; }
      #bk-compare-selects select {
        flex: 1; background: #2c2c2e; border: 1px solid #48484a;
        border-radius: 6px; color: #f2f2f7; font-size: 11px;
        padding: 4px 6px; outline: none; cursor: pointer;
      }
      .bk-cmp-gain { color: #5ac85a; font-weight: 700; }
      .bk-cmp-loss { color: #e63c14; font-weight: 700; }
      .bk-cmp-same { color: #48484a; }
      .bk-bd-table tr.no-diff td { opacity: 0.35; }
      #bk-bd-player-tags {
        display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px;
      }
      #bk-bd-player-tags:empty { display: none; }
      #bk-bd-player-input-wrap { position: relative; margin-bottom: 8px; }
      #bk-breakdown-search { margin-bottom: 0; }
      #bk-bd-autocomplete {
        position: fixed;
        background: #2c2c2e; border: 1px solid #48484a; border-radius: 6px;
        z-index: 10002; max-height: 160px; overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      }
      #bk-bd-autocomplete:empty { display: none; }
    `);
  }

  // ─── Build UI ─────────────────────────────────────────────────────────────────
  function buildUI(sections, boxPacks) {
    injectStyles();

    const hasOdds = sections.some((s) => Object.keys(s.odds).length > 0);
    const boxTypes = hasOdds
      ? ['Hobby', 'Jumbo', 'Value', 'Mega'].filter((t) => sections.some((s) => s.odds[t] != null))
      : [];

    // ── Toggle button ──
    const toggle = document.createElement('button');
    toggle.id = 'bk-toggle';
    toggle.textContent = 'FILTER';
    toggle.title = 'Toggle card filter panel';
    document.body.appendChild(toggle);

    // ── Sidebar ──
    const sidebar = document.createElement('div');
    sidebar.id = 'bk-sidebar';
    sidebar.innerHTML = `
      <div id="bk-resize"></div>
      <div id="bk-sidebar-head">
        <h2>🃏 Card Filter</h2>
        <div id="bk-view-tabs">
          <button class="bk-view-tab active" data-view="results">📋 Results</button>
          <button class="bk-view-tab" data-view="breakdown">📊 Breakdown</button>
        </div>
        <div class="bk-box-row" id="bk-box-row"></div>
        <div id="bk-filters">
          <div class="bk-filter-row" style="align-items:flex-start">
            <span class="bk-filter-label" style="padding-top:5px">👤 Player</span>
            <div id="bk-player-box">
              <div id="bk-player-tags"></div>
              <div id="bk-player-input-wrap">
                <input id="bk-search" type="text" placeholder="Type to search…" autocomplete="off">
                <div id="bk-autocomplete"></div>
              </div>
            </div>
          </div>
          <div class="bk-filter-row">
            <span class="bk-filter-label">🏀 Team</span>
            <select id="bk-team-select" class="bk-select"><option value="">All teams</option></select>
          </div>
          <div class="bk-filter-row">
            <span class="bk-filter-label">📂 Tab</span>
            <select id="bk-tab-select" class="bk-select"><option value="">All tabs</option></select>
          </div>
          <div class="bk-filter-row">
            <span class="bk-filter-label">🎴 Type</span>
            <select id="bk-type-select" class="bk-select"><option value="">All types</option></select>
          </div>
          <div id="bk-filter-actions">
            <button id="bk-clear">✕ Clear</button>
            <button id="bk-save-default">💾 Set default</button>
          </div>
          <div id="bk-summary"></div>
        </div>
      </div>
      <div id="bk-results"></div>
      <div id="bk-breakdown-area">
        <div class="bk-bd-actions">
          <button id="bk-snap-btn">📸 Snapshot</button>
          <button id="bk-compare-btn">⚖️ Compare</button>
          <span class="bk-snap-label" id="bk-snap-label"></span>
        </div>
        <div id="bk-compare-selects">
          <select id="bk-cmp-a"></select>
          <select id="bk-cmp-b"></select>
        </div>
        <div id="bk-bd-player-tags"></div>
        <div id="bk-bd-player-input-wrap">
          <input id="bk-breakdown-search" type="text" placeholder="Search player…" autocomplete="off">
          <div id="bk-bd-autocomplete"></div>
        </div>
        <div id="bk-bd-table-wrap"></div>
      </div>
    `;
    document.body.appendChild(sidebar);

    const boxRow = sidebar.querySelector('#bk-box-row');
    const searchInput = sidebar.querySelector('#bk-search');
    const teamSelect = sidebar.querySelector('#bk-team-select');
    const tabSelect = sidebar.querySelector('#bk-tab-select');
    const typeSelect = sidebar.querySelector('#bk-type-select');
    const summaryEl = sidebar.querySelector('#bk-summary');
    const resultsEl = sidebar.querySelector('#bk-results');

    let currentBoxType = boxTypes.length > 0 ? boxTypes[0] : 'all-inserts';
    let sidebarOpen = true;
    let sidebarW = 300;
    const MIN_W = 180, MAX_W = 600;

    // ── Toggle open/close ──
    const pageRoot = document.querySelector('#page, #wrapper, .wide, #content, main, article, .site-content, .entry-content')
      || document.body;

    function setOpen(open) {
      sidebarOpen = open;
      sidebar.classList.toggle('open', open);
      toggle.classList.toggle('open', open);
      pageRoot.style.setProperty('margin-left', open ? (sidebarW + 2) + 'px' : '', 'important');
      pageRoot.style.setProperty('transition', 'margin-left 0.25s', 'important');
    }

    toggle.onclick = () => setOpen(!sidebarOpen);

    // ── Resize handle ──
    const resizeHandle = sidebar.querySelector('#bk-resize');

    function applyWidth(w) {
      sidebarW = Math.max(MIN_W, Math.min(MAX_W, w));
      document.documentElement.style.setProperty('--bk-w', sidebarW + 2 + 'px');
      if (sidebarOpen) {
        pageRoot.style.setProperty('margin-left', (sidebarW + 2) + 'px', 'important');
      }
    }

    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarW;
      sidebar.classList.add('dragging');
      resizeHandle.classList.add('active');

      function onMove(e) {
        applyWidth(startW + e.clientX - startX);
      }
      function onUp() {
        sidebar.classList.remove('dragging');
        resizeHandle.classList.remove('active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Start open (frozen/pinned)
    setOpen(true);

    // ── Box type buttons ──
    if (boxTypes.length > 0) {
      boxTypes.forEach((type) => {
        const btn = document.createElement('button');
        btn.className = 'bk-box-btn' + (type === currentBoxType ? ' active' : '');
        btn.textContent = type;
        btn.onclick = () => {
          currentBoxType = type;
          boxRow.querySelectorAll('.bk-box-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          populateDropdowns();
          renderActive();
        };
        boxRow.appendChild(btn);
      });
    } else {
      const btn = document.createElement('button');
      btn.className = 'bk-box-btn active';
      btn.textContent = 'All Inserts';
      boxRow.appendChild(btn);
    }

    function getBaseSections() {
      if (!hasOdds || currentBoxType === 'all-inserts') return sections;
      return sections.filter((s) => Object.keys(s.odds).length === 0 || s.odds[currentBoxType] != null);
    }

    function populateDropdowns() {
      const base = getBaseSections();

      const allTeams = [...new Set(
        base.flatMap((s) => s.cards.flatMap((c) => c.team ? c.team.split('/').map(t => t.trim()) : []))
      )].filter(Boolean).sort();
      const allTabs = [...new Set(base.filter((s) => !SKIP_TYPE.test(s.tabName)).map((s) => s.tabName).filter(Boolean))];

      teamSelect.innerHTML = '<option value="">All teams</option>';
      allTeams.forEach((t) => {
        const o = document.createElement('option'); o.value = t; o.textContent = t; teamSelect.appendChild(o);
      });

      tabSelect.innerHTML = '<option value="">All tabs</option>';
      allTabs.forEach((t) => {
        const o = document.createElement('option'); o.value = t; o.textContent = t; tabSelect.appendChild(o);
      });

      rebuildTypeOptions(base);
    }

    function rebuildTypeOptions(base) {
      typeSelect.innerHTML = '<option value="">All types</option>';
      base.filter((s) => !SKIP_TYPE.test(s.title) && !SKIP_TYPE.test(s.tabName)).forEach((s) => {
        const o = document.createElement('option');
        o.value = `${s.tabName}::${s.title}`;
        o.textContent = `[${s.tabName}] ${s.title}`;
        typeSelect.appendChild(o);
      });
    }

    tabSelect.addEventListener('change', () => {
      const selectedTab = tabSelect.value;
      const base = getBaseSections();
      const relevantSections = selectedTab ? base.filter((s) => s.tabName === selectedTab) : base;
      rebuildTypeOptions(relevantSections);
      typeSelect.value = '';
      renderActive();
    });

    // ── Player tag system ──
    const tagsEl = sidebar.querySelector('#bk-player-tags');
    const acEl = sidebar.querySelector('#bk-autocomplete');
    let playerTags = [];
    let recentPlayers = []; // last 5 used, greyed when not active

    const allPlayers = [...new Set(sections.filter(s => !SKIP_TYPE.test(s.title) && !SKIP_TYPE.test(s.tabName)).flatMap(s => s.cards.map(c => c.player)).filter(Boolean))].sort();

    function trackRecent(name) {
      recentPlayers = [name, ...recentPlayers.filter(p => p !== name)].slice(0, 5);
    }

    function renderTags() {
      tagsEl.innerHTML = '';
      // active tags
      playerTags.forEach((name) => {
        const chip = document.createElement('span');
        chip.className = 'bk-player-tag';
        chip.textContent = name;
        const x = document.createElement('button');
        x.textContent = '×';
        x.title = 'Remove';
        x.onclick = () => { playerTags = playerTags.filter(p => p !== name); renderTags(); renderActive(); };
        chip.appendChild(x);
        tagsEl.appendChild(chip);
      });
      // recent (greyed, not yet active)
      const inactiveRecent = recentPlayers.filter(p => !playerTags.includes(p));
      if (inactiveRecent.length > 0) {
        const sep = document.createElement('span');
        sep.style.cssText = 'display:inline-block;width:1px;height:14px;background:#3a3a3c;margin:0 4px;vertical-align:middle';
        tagsEl.appendChild(sep);
        inactiveRecent.forEach((name) => {
          const chip = document.createElement('span');
          chip.className = 'bk-player-tag bk-recent-tag';
          chip.title = 'Click to activate';
          chip.textContent = name;
          chip.onclick = () => {
            playerTags.push(name);
            renderTags();
            renderActive();
          };
          tagsEl.appendChild(chip);
        });
      }
    }

    function positionAc(acDropdown, inputEl) {
      const r = inputEl.getBoundingClientRect();
      acDropdown.style.top = (r.bottom + 2) + 'px';
      acDropdown.style.left = r.left + 'px';
      acDropdown.style.width = r.width + 'px';
    }

    function showAutocomplete(q) {
      acEl.innerHTML = '';
      if (!q) return;
      const lq = q.toLowerCase();
      const matches = allPlayers.filter(p => p.toLowerCase().includes(lq) && !playerTags.includes(p)).slice(0, 12);
      matches.forEach((name) => {
        const item = document.createElement('div');
        item.className = 'bk-ac-item';
        const idx = name.toLowerCase().indexOf(lq);
        item.innerHTML = name.slice(0, idx) + '<em>' + name.slice(idx, idx + q.length) + '</em>' + name.slice(idx + q.length);
        item.onmousedown = (e) => {
          e.preventDefault();
          trackRecent(name);
          playerTags.push(name);
          searchInput.value = '';
          acEl.innerHTML = '';
          renderTags();
          renderActive();
        };
        acEl.appendChild(item);
      });
      positionAc(acEl, searchInput);
    }

    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        showAutocomplete(searchInput.value.trim());
        renderActive();
      }, 120);
    });
    searchInput.addEventListener('blur', () => setTimeout(() => { acEl.innerHTML = ''; }, 150));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { acEl.innerHTML = ''; searchInput.value = ''; renderActive(); }
      if (e.key === 'Enter') {
        const first = acEl.querySelector('.bk-ac-item');
        if (first) { e.preventDefault(); first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }
      }
    });

    teamSelect.addEventListener('change', renderActive);
    typeSelect.addEventListener('change', renderActive);

    const LS_KEY = 'bk-filter-default';
    const saveDefaultBtn = sidebar.querySelector('#bk-save-default');

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

    function loadDefault() {
      try {
        const cfg = deserializeConfig(JSON.parse(localStorage.getItem(LS_KEY) || 'null'));
        if (!cfg) return;
        playerTags    = cfg.playerTags;
        recentPlayers = cfg.recentPlayers;
        if (cfg.boxType && boxTypes.includes(cfg.boxType)) {
          currentBoxType = cfg.boxType;
          boxRow.querySelectorAll('.bk-box-btn').forEach((b) => {
            b.classList.toggle('active', b.textContent.trim() === cfg.boxType);
          });
          populateDropdowns();
        }
        teamSelect.value = cfg.team;
        tabSelect.value  = cfg.tab;
        if (cfg.tab) {
          const base = getBaseSections();
          rebuildTypeOptions(base.filter((s) => s.tabName === cfg.tab));
        }
        typeSelect.value = cfg.type;
        renderTags();
        if (cfg.bdPlayerTags.size > 0) {
          bdPlayerTags = cfg.bdPlayerTags;
          renderBdTags();
        }
        bdSortCol = cfg.bdSortCol;
        bdSortDir = cfg.bdSortDir;
        saveDefaultBtn.classList.add('has-default');
        saveDefaultBtn.title = 'Default saved — click to update';
      } catch (e) {}
    }

    function saveDefault() {
      const cfg = serializeConfig({
        playerTags, recentPlayers, boxType: currentBoxType,
        team: teamSelect.value, tab: tabSelect.value, type: typeSelect.value,
        bdPlayerTags, bdSortCol, bdSortDir,
      });
      localStorage.setItem(LS_KEY, JSON.stringify(cfg));
      saveDefaultBtn.classList.add('has-default');
      saveDefaultBtn.title = 'Default saved — click to update';
      saveDefaultBtn.textContent = '✓ Saved';
      setTimeout(() => { saveDefaultBtn.textContent = '💾 Set default'; }, 1200);
    }

    saveDefaultBtn.onclick = saveDefault;

    sidebar.querySelector('#bk-clear').onclick = () => {
      searchInput.value = '';
      playerTags = [];
      renderTags();
      acEl.innerHTML = '';
      teamSelect.value = '';
      tabSelect.value = '';
      typeSelect.value = '';
      renderActive();
    };

    const allTabs = [...new Set(sections.filter((s) => !SKIP_TYPE.test(s.tabName)).map((s) => s.tabName).filter(Boolean))];

    // ── View switching ──
    let currentView = 'results';
    const resultsViewEl = sidebar.querySelector('#bk-results');
    const breakdownViewEl = sidebar.querySelector('#bk-breakdown-area');
    const bdSearchEl = sidebar.querySelector('#bk-breakdown-search');
    const bdTableWrap = sidebar.querySelector('#bk-bd-table-wrap');
    const bdTagsEl = sidebar.querySelector('#bk-bd-player-tags');
    const bdAcEl = sidebar.querySelector('#bk-bd-autocomplete');
    // bdPlayerTags: Map<name, colorIndex>
    let bdPlayerTags = new Map();
    let bdSortCol = null; // null = alpha by player, 'total', or tabCol name
    let bdSortDir = 1;    // 1 = desc, -1 = asc
    const BD_TAG_PALETTE = [
      { bg: '#2d1a0e', border: '#c85a1a', text: '#ff8c6e' }, // orange
      { bg: '#0d1f35', border: '#1e5fa0', text: '#5aadff' }, // blue
      { bg: '#1a2d0e', border: '#4a9a1a', text: '#7ddd50' }, // green
      { bg: '#2d2200', border: '#a07000', text: '#ffc130' }, // gold
      { bg: '#1f0d2a', border: '#7a30b0', text: '#c97dff' }, // purple
      { bg: '#2a0d0d', border: '#b02020', text: '#ff6b6b' }, // red
      { bg: '#0d2a2a', border: '#1a8080', text: '#4dcccc' }, // teal
      { bg: '#2a1a00', border: '#907000', text: '#e0a030' }, // amber
    ];
    const snapBtn = sidebar.querySelector('#bk-snap-btn');
    const compareBtn = sidebar.querySelector('#bk-compare-btn');
    const snapLabelEl = sidebar.querySelector('#bk-snap-label');
    const cmpSelects = sidebar.querySelector('#bk-compare-selects');
    const cmpA = sidebar.querySelector('#bk-cmp-a');
    const cmpB = sidebar.querySelector('#bk-cmp-b');

    function switchToResults() {
      currentView = 'results';
      sidebar.querySelectorAll('.bk-view-tab').forEach(b => b.classList.toggle('active', b.dataset.view === 'results'));
      resultsViewEl.style.display = '';
      breakdownViewEl.classList.remove('active');
    }

    function goToResultsWithPlayer(playerName) {
      if (!playerTags.includes(playerName)) {
        trackRecent(playerName);
        playerTags.push(playerName);
        renderTags();
      }
      switchToResults();
      render();
      resultsViewEl.scrollTop = 0;
    }

    function goToResultsWithPlayerAndTab(playerName, tabName) {
      if (!playerTags.includes(playerName)) {
        trackRecent(playerName);
        playerTags.push(playerName);
        renderTags();
      }
      tabSelect.value = tabName;
      // rebuild type options for this tab
      const base = getBaseSections();
      const relevantSections = base.filter((s) => s.tabName === tabName);
      rebuildTypeOptions(relevantSections);
      typeSelect.value = '';
      switchToResults();
      render();
      resultsViewEl.scrollTop = 0;
    }

    sidebar.querySelectorAll('.bk-view-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentView = btn.dataset.view;
        sidebar.querySelectorAll('.bk-view-tab').forEach(b => b.classList.toggle('active', b === btn));
        resultsViewEl.style.display = currentView === 'results' ? '' : 'none';
        breakdownViewEl.classList.toggle('active', currentView === 'breakdown');
        if (currentView === 'breakdown') renderBreakdown();
      });
    });

    // ── Snapshot store ──
    const snapshots = [];
    let compareMode = false;

    function getActiveLabel() {
      const box = currentBoxType === 'all-inserts' ? 'All' : currentBoxType;
      const tab = tabSelect.value || 'All tabs';
      const players = playerTags.length > 0 ? playerTags.join(', ') : '';
      return [box, tab, players].filter(Boolean).join(' · ');
    }

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

    function getCurrentBreakdownSections() {
      const query = searchInput.value.trim().toLowerCase();
      const teamFilter = teamSelect.value;
      const tabFilter = tabSelect.value;
      const typeFilter = typeSelect.value;
      const [typeTab, typeTitle] = typeFilter ? typeFilter.split('::') : [];
      const base = getBaseSections();
      return base
        .filter((s) => !SKIP_TYPE.test(s.title) && !SKIP_TYPE.test(s.tabName))
        .filter((s) => !tabFilter || s.tabName === tabFilter)
        .filter((s) => !typeFilter || (s.tabName === typeTab && s.title === typeTitle))
        .map((s) => ({
          ...s,
          cards: s.cards.filter((c) => {
            if (teamFilter && !c.team.split('/').map(t => t.trim()).includes(teamFilter)) return false;
            if (playerTags.length > 0 && !playerTags.includes(c.player)) return false;
            if (query && !c.player.toLowerCase().includes(query)) return false;
            return true;
          }),
        }))
        .filter((s) => s.cards.length > 0);
    }

    function renderBreakdownTable(tabCols, playerMap, bdQuery, compareSnap) {
      bdTableWrap.innerHTML = '';
      const lq = bdQuery.toLowerCase();
      let players = Object.keys(playerMap).sort();
      if (bdPlayerTags.size > 0) {
        const tagSet = bdPlayerTags;
        const pinned = [...bdPlayerTags.keys()].filter(p => playerMap[p] || (compareSnap && compareSnap.playerMap[p]));
        const rest = players.filter(p => !tagSet.has(p) && (!lq || p.toLowerCase().includes(lq)));
        players = [...pinned, ...rest];
      } else if (lq) {
        players = players.filter(p => p.toLowerCase().includes(lq));
      }

      // sort by column (pinned players always stay on top)
      if (bdSortCol) {
        const pinnedSet = new Set(bdPlayerTags.size > 0 ? [...bdPlayerTags.keys()].filter(p => playerMap[p] || (compareSnap && compareSnap.playerMap[p])) : []);
        const sortFn = (a, b) => {
          if (pinnedSet.has(a) !== pinnedSet.has(b)) return pinnedSet.has(a) ? -1 : 1;
          if (bdSortCol === 'player') return a.localeCompare(b) * bdSortDir;
          const getVal = (p) => bdSortCol === 'total'
            ? tabCols.reduce((n, c) => n + (playerMap[p][c] || 0), 0)
            : (playerMap[p][bdSortCol] || 0);
          return (getVal(b) - getVal(a)) * bdSortDir;
        };
        players = [...players].sort(sortFn);
      }

      if (players.length === 0) {
        bdTableWrap.innerHTML = '<div class="bk-empty">No players.</div>';
        return;
      }

      const table = document.createElement('table');
      table.className = 'bk-bd-table';

      const makeTh = (label, colKey, extraCss) => {
        const th = document.createElement('th');
        const isActive = bdSortCol === colKey;
        const arrow = isActive ? (bdSortDir === 1 ? ' ▼' : ' ▲') : '';
        th.textContent = label + arrow;
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';
        if (isActive) th.style.color = '#ffc130';
        if (extraCss) th.style.cssText += extraCss;
        th.addEventListener('click', () => {
          if (bdSortCol === colKey) {
            bdSortDir = bdSortDir === 1 ? -1 : 1;
          } else {
            bdSortCol = colKey;
            bdSortDir = colKey === 'player' ? -1 : 1; // player: A→Z first; counts: high→low first
          }
          renderBreakdown();
        });
        return th;
      };

      const thead = table.createTHead();
      const hrow = thead.insertRow();
      hrow.appendChild(makeTh('Player', 'player'));
      tabCols.forEach((col) => {
        const label = col.replace(/autographs/i, 'Auto').replace(/inserts/i, 'Ins').replace(/memorabilia/i, 'Mem');
        hrow.appendChild(makeTh(label, col));
      });
      if (tabCols.length > 1) {
        hrow.appendChild(makeTh('Total', 'total', ';border-left:1px solid #3a3a3c'));
      }

      const tbody = table.createTBody();
      const tagSet = bdPlayerTags;
      let passedPinned = false;
      players.forEach((player) => {
        if (bdPlayerTags.size > 0 && !tagSet.has(player) && !passedPinned) {
          passedPinned = true;
          const sep = tbody.insertRow();
          sep.style.cssText = 'height:1px;background:#3a3a3c;pointer-events:none';
          const td = sep.insertCell();
          td.colSpan = tabCols.length + (tabCols.length > 1 ? 2 : 1);
          td.style.cssText = 'padding:0;background:#3a3a3c';
        }
        const row = tbody.insertRow();
        const playerTagColor = tagSet.has(player) ? BD_TAG_PALETTE[tagSet.get(player) % BD_TAG_PALETTE.length] : null;
        if (playerTagColor) row.style.background = playerTagColor.bg + '88';
        const tdName = row.insertCell();
        tdName.textContent = player;
        if (playerTagColor) tdName.style.color = playerTagColor.text;
        tdName.style.cursor = 'pointer';
        tdName.title = 'Show in Results';
        tdName.addEventListener('click', () => goToResultsWithPlayer(player));

        let hasDiff = false;
        tabCols.forEach((col) => {
          const td = row.insertCell();
          const val = playerMap[player][col] || 0;
          if (compareSnap) {
            const prev = (compareSnap.playerMap[player] || {})[col] || 0;
            const delta = val - prev;
            if (delta !== 0) hasDiff = true;
            if (val === 0 && prev === 0) {
              td.textContent = '—';
            } else {
              td.innerHTML = `${val}`;
              if (delta > 0) { td.innerHTML += ` <span class="bk-cmp-gain">+${delta}</span>`; hasDiff = true; }
              else if (delta < 0) { td.innerHTML += ` <span class="bk-cmp-loss">${delta}</span>`; hasDiff = true; }
              else if (val > 0) td.className = 'bk-cmp-same';
            }
            if (val > 0 || prev > 0) td.classList.add('has-val');
          } else {
            if (val > 0) {
              td.textContent = val;
              td.className = 'has-val';
              td.style.cursor = 'pointer';
              td.title = `Show ${player} in ${col}`;
              td.addEventListener('click', () => goToResultsWithPlayerAndTab(player, col));
            } else {
              td.textContent = '—';
            }
          }
        });

        if (tabCols.length > 1) {
          const tdTotal = row.insertCell();
          tdTotal.style.cssText = 'border-left:1px solid #3a3a3c;text-align:center;font-weight:700';
          if (compareSnap) {
            const totalB = tabCols.reduce((n, c) => n + (playerMap[player][c] || 0), 0);
            const totalA = tabCols.reduce((n, c) => n + ((compareSnap.playerMap[player] || {})[c] || 0), 0);
            const delta = totalB - totalA;
            if (totalB === 0 && totalA === 0) {
              tdTotal.textContent = '—';
              tdTotal.style.color = '#48484a';
            } else {
              tdTotal.style.color = '#ffc130';
              tdTotal.textContent = totalB;
              if (delta > 0) tdTotal.innerHTML += ` <span class="bk-cmp-gain">+${delta}</span>`;
              else if (delta < 0) tdTotal.innerHTML += ` <span class="bk-cmp-loss">${delta}</span>`;
            }
          } else {
            const total = tabCols.reduce((n, c) => n + (playerMap[player][c] || 0), 0);
            if (total > 0) {
              tdTotal.textContent = total;
              tdTotal.style.color = '#ffc130';
            } else {
              tdTotal.textContent = '—';
              tdTotal.style.color = '#48484a';
            }
          }
        }

        if (compareSnap && !hasDiff) row.classList.add('no-diff');
      });

      table.appendChild(thead);
      table.appendChild(tbody);
      bdTableWrap.appendChild(table);
    }

    function renderBreakdown() {
      if (compareMode && snapshots.length >= 2 && cmpA.value !== '' && cmpB.value !== '') {
        const idxA = parseInt(cmpA.value);
        const idxB = parseInt(cmpB.value);
        const snapA = snapshots[idxA];
        const snapB = snapshots[idxB];
        // Merged columns from both snapshots
        const tabCols = [...new Set([...snapA.tabCols, ...snapB.tabCols])];
        // Merged player list from both
        const allPlayerNames = [...new Set([...Object.keys(snapA.playerMap), ...Object.keys(snapB.playerMap)])];
        const mergedMap = {};
        allPlayerNames.forEach(p => { mergedMap[p] = snapB.playerMap[p] || {}; });
        renderBreakdownTable(tabCols, mergedMap, bdSearchEl.value.trim(), snapA);
        return;
      }

      const activeSections = getCurrentBreakdownSections();
      const { tabCols, playerMap } = buildBreakdownData(activeSections);
      renderBreakdownTable(tabCols, playerMap, bdSearchEl.value.trim(), null);
    }

    function bdTagColor(name) {
      return BD_TAG_PALETTE[bdPlayerTags.get(name) % BD_TAG_PALETTE.length];
    }

    function applyTagStyle(el, c) {
      el.style.background = c.bg;
      el.style.border = `1px solid ${c.border}`;
      el.style.color = c.text;
    }

    function renderBdTags() {
      bdTagsEl.innerHTML = '';
      bdPlayerTags.forEach((colorIdx, name) => {
        const c = BD_TAG_PALETTE[colorIdx % BD_TAG_PALETTE.length];
        const chip = document.createElement('span');
        chip.className = 'bk-player-tag';
        chip.title = 'Click to change color';
        chip.style.cursor = 'pointer';
        applyTagStyle(chip, c);
        chip.appendChild(document.createTextNode(name));
        chip.addEventListener('click', (e) => {
          if (e.target.tagName === 'BUTTON') return;
          bdPlayerTags.set(name, (colorIdx + 1) % BD_TAG_PALETTE.length);
          renderBdTags();
          renderBreakdown();
        });
        const x = document.createElement('button');
        x.textContent = '×';
        x.title = 'Remove';
        x.style.color = c.border;
        x.onclick = () => { bdPlayerTags.delete(name); renderBdTags(); renderBreakdown(); };
        chip.appendChild(x);
        bdTagsEl.appendChild(chip);
      });
    }

    function showBdAutocomplete(q) {
      bdAcEl.innerHTML = '';
      if (!q) return;
      const lq = q.toLowerCase();
      const pool = compareMode && snapshots.length >= 2
        ? [...new Set([...Object.keys(snapshots[parseInt(cmpA.value) || 0].playerMap), ...Object.keys(snapshots[parseInt(cmpB.value) || 1].playerMap)])]
        : allPlayers;
      const matches = pool.filter(p => p.toLowerCase().includes(lq) && !bdPlayerTags.has(p)).slice(0, 12);
      matches.forEach((name) => {
        const item = document.createElement('div');
        item.className = 'bk-ac-item';
        const idx = name.toLowerCase().indexOf(lq);
        item.innerHTML = name.slice(0, idx) + '<em>' + name.slice(idx, idx + q.length) + '</em>' + name.slice(idx + q.length);
        item.onmousedown = (e) => {
          e.preventDefault();
          bdPlayerTags.set(name, bdPlayerTags.size % BD_TAG_PALETTE.length);
          bdSearchEl.value = '';
          bdAcEl.innerHTML = '';
          renderBdTags();
          renderBreakdown();
        };
        bdAcEl.appendChild(item);
      });
      positionAc(bdAcEl, bdSearchEl);
    }

    bdSearchEl.addEventListener('input', () => {
      showBdAutocomplete(bdSearchEl.value.trim());
      if (currentView === 'breakdown') renderBreakdown();
    });
    bdSearchEl.addEventListener('blur', () => setTimeout(() => { bdAcEl.innerHTML = ''; }, 150));
    bdSearchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { bdAcEl.innerHTML = ''; bdSearchEl.value = ''; renderBreakdown(); }
      if (e.key === 'Enter') {
        const first = bdAcEl.querySelector('.bk-ac-item');
        if (first) { e.preventDefault(); first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }
      }
    });

    snapBtn.addEventListener('click', () => {
      const activeSections = getCurrentBreakdownSections();
      const { tabCols, playerMap } = buildBreakdownData(activeSections);
      const label = getActiveLabel() || `Snapshot ${snapshots.length + 1}`;
      snapshots.push({ label, tabCols, playerMap });
      updateSnapUI();
      // Auto-enter compare mode on 2nd snapshot
      if (snapshots.length === 2 && !compareMode) {
        compareMode = true;
        applyCompareMode();
      }
      renderBreakdown();
    });

    function applyCompareMode() {
      cmpSelects.classList.toggle('active', compareMode);
      compareBtn.textContent = compareMode ? '📋 Live' : '⚖️ Compare';
      compareBtn.style.background = compareMode ? '#3a1c1c' : '';
      compareBtn.style.borderColor = compareMode ? '#e63c14' : '';
      compareBtn.style.color = compareMode ? '#ff6b47' : '';
    }

    function updateSnapUI() {
      if (snapshots.length >= 2) {
        compareBtn.style.display = '';
        snapLabelEl.textContent = '';
      } else if (snapshots.length === 1) {
        snapLabelEl.textContent = `Saved: ${snapshots[0].label}`;
      }
      [cmpA, cmpB].forEach((sel, i) => {
        sel.innerHTML = snapshots.map((s, idx) => `<option value="${idx}">[${idx + 1}] ${s.label}</option>`).join('');
        sel.value = i === 0 ? '0' : String(snapshots.length - 1);
      });
    }

    compareBtn.addEventListener('click', () => {
      compareMode = !compareMode;
      applyCompareMode();
      renderBreakdown();
    });

    [cmpA, cmpB].forEach(sel => sel.addEventListener('change', renderBreakdown));

    function renderActive() {
      render();
      if (currentView === 'breakdown') renderBreakdown();
    }

    // restore defaults now that all state vars and render fns are declared
    loadDefault();

    function render() {
      const query = searchInput.value.trim().toLowerCase();
      const teamFilter = teamSelect.value;
      const tabFilter = tabSelect.value;
      const typeFilter = typeSelect.value;
      const hasFilters = playerTags.length > 0 || query || teamFilter || tabFilter || typeFilter;

      const [typeTab, typeTitle] = typeFilter ? typeFilter.split('::') : [];
      const base = getBaseSections();

      const filtered = base
        .filter((s) => !SKIP_TYPE.test(s.title) && !SKIP_TYPE.test(s.tabName))
        .filter((s) => !tabFilter || s.tabName === tabFilter)
        .filter((s) => !typeFilter || (s.tabName === typeTab && s.title === typeTitle))
        .map((s) => {
          const visibleCards = s.cards.filter((c) => {
            if (teamFilter && !c.team.split('/').map(t => t.trim()).includes(teamFilter)) return false;
            if (playerTags.length > 0 && !playerTags.includes(c.player)) return false;
            if (query && !c.player.toLowerCase().includes(query) && !c.team.toLowerCase().includes(query)) return false;
            return true;
          });
          return { ...s, visibleCards };
        })
        .filter((s) => s.visibleCards.length > 0);

      const totalCards = filtered.reduce((n, s) => n + s.visibleCards.length, 0);
      summaryEl.innerHTML = `📦 <strong style="color:#aaa">${filtered.length}</strong> sets &nbsp;🃏 <strong style="color:#${hasFilters ? 'e63c14' : 'aaa'}">${totalCards}</strong> cards${hasFilters ? ' matching' : ''}`;

      resultsEl.innerHTML = '';
      if (filtered.length === 0) {
        resultsEl.innerHTML = `<div class="bk-empty">No cards match.</div>`;
        return;
      }

      filtered.forEach((s) => {
        const oddsPerPack = s.odds[currentBoxType];
        const packs = boxPacks[currentBoxType];
        const rate = hitRate(oddsPerPack, packs);

        const setEl = document.createElement('div');
        setEl.className = 'bk-set';

        const titleRow = document.createElement('div');
        titleRow.className = 'bk-set-title';
        if (allTabs.length > 1 && s.tabName) {
          const tag = document.createElement('span');
          const tabKey = s.tabName.toLowerCase().replace(/\s+/g, '-');
          const tabClass = ['autographs', 'inserts', 'memorabilia'].find(t => tabKey.includes(t)) || 'other';
          tag.className = `bk-tab-tag bk-tab-tag-${tabClass}`;
          tag.textContent = s.tabName;
          titleRow.appendChild(tag);
        }
        titleRow.appendChild(document.createTextNode(s.title));
        if (rate) {
          const rateEl = document.createElement('span');
          rateEl.className = 'bk-hit-rate';
          rateEl.textContent = rate;
          titleRow.appendChild(rateEl);
        }

        const meta = document.createElement('div');
        meta.className = 'bk-set-meta';
        const showing = s.visibleCards.length < s.cards.length ? `${s.visibleCards.length}/${s.cards.length}` : `${s.cards.length}`;
        meta.textContent = oddsPerPack ? `🎲 1:${oddsPerPack.toLocaleString()} packs · 🃏 ${showing}` : `🃏 ${showing} cards`;

        const cardsEl = document.createElement('div');
        cardsEl.className = 'bk-cards';
        s.visibleCards.forEach((c) => {
          const row = document.createElement('div');
          row.className = 'bk-card' + (hasFilters ? ' highlight' : '');
          const idEl = document.createElement('span');
          idEl.className = 'bk-card-id';
          idEl.textContent = c.id;
          const nameEl = document.createElement('span');
          nameEl.textContent = c.player;
          if (c.player && !playerTags.includes(c.player)) {
            nameEl.style.cursor = 'pointer';
            nameEl.title = 'Filter by this player';
            nameEl.addEventListener('click', () => {
              playerTags.push(c.player);
              renderTags();
              render();
            });
          }
          row.appendChild(idEl);
          row.appendChild(nameEl);
          if (c.team) {
            const teamEl = document.createElement('span');
            teamEl.className = 'bk-card-team';
            teamEl.textContent = c.team;
            row.appendChild(teamEl);
          }
          cardsEl.appendChild(row);
        });

        setEl.appendChild(titleRow);
        setEl.appendChild(meta);
        setEl.appendChild(cardsEl);
        resultsEl.appendChild(setEl);
      });
    }

    populateDropdowns();

    // ── Hash-based auto-filter ──
    // e.g. #trailblazers → match team "Portland Trail Blazers"
    //      #autographs   → match tab
    function applyHashFilter() {
      const hash = location.hash.replace('#', '').toLowerCase().replace(/[-_]/g, '');
      if (!hash) return;

      // Try tab first (skip blank option)
      const tabOpt = Array.from(tabSelect.options).find(o => {
        if (!o.value) return false;
        const slug = o.value.toLowerCase().replace(/\s+/g, '');
        return slug === hash || slug.startsWith(hash) || hash.startsWith(slug);
      });
      if (tabOpt) {
        tabSelect.value = tabOpt.value;
        const base = getBaseSections();
        rebuildTypeOptions(base.filter(s => s.tabName === tabOpt.value));
        typeSelect.value = '';
        render();
        return;
      }

      // Try team — prefer exact slug match, then shortest slug containing hash (avoids combo teams)
      const toSlug = v => v.toLowerCase().replace(/\s+/g, '').replace(/[^a-z]/g, '');
      const teamOpts = Array.from(teamSelect.options).filter(o => o.value);
      const exactMatch = teamOpts.find(o => toSlug(o.value) === hash);
      const subMatches = teamOpts.filter(o => toSlug(o.value).includes(hash));
      subMatches.sort((a, b) => toSlug(a.value).length - toSlug(b.value).length);
      const teamOpt = exactMatch || subMatches[0];
      if (teamOpt) {
        teamSelect.value = teamOpt.value;
        render();
      }
    }

    applyHashFilter();
    window.addEventListener('hashchange', applyHashFilter);

    render();
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    if (document.getElementById('bk-toggle')) return;

    const boxPacks = parseBoxPacks();
    const tabBodies = findAllTabBodies();
    if (tabBodies.length === 0) {
      console.warn('[BK] No tab bodies found');
      return;
    }

    const sections = [];
    tabBodies.forEach(({ tabName, body }) => {
      parseSections(body, tabName).forEach((s) => sections.push(s));
    });

    if (sections.length === 0) {
      console.warn('[BK] No card sections parsed');
      return;
    }

    buildUI(sections, boxPacks);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Also try on full window load (images/scripts done) — catches pages where tab
  // content is injected after DOMContentLoaded (e.g. Gutenberg block hydration)
  window.addEventListener('load', init);

  let retries = 0, observerTimer;
  const observer = new MutationObserver(() => {
    if (document.getElementById('bk-toggle')) { observer.disconnect(); return; }
    if (++retries > 40) { observer.disconnect(); return; }
    clearTimeout(observerTimer);
    observerTimer = setTimeout(init, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
