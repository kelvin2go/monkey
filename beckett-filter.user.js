// ==UserScript==
// @name         Beckett Card Filter
// @namespace    https://github.com/kelvin2go/card-script
// @version      2.0.0
// @description  Filter inserts by box type and show hit rates on Beckett checklist pages
// @author       kelvin2go
// @match        https://www.beckett.com/news/*
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Parse packs-per-box from article text ────────────────────────────────────
  // e.g. "Packs per box: Hobby – 4; Jumbo – 4; Value – 6; Mega – 10"
  function parseBoxPacks() {
    const text = document.body.innerText;
    const m = text.match(/Packs per box[:\s]+([^\n]+)/i);
    if (!m) return {};
    const result = {};
    m[1].replace(/(\w+)\s*[–\-]\s*(\d+)/g, (_, type, n) => {
      result[type] = parseInt(n, 10);
    });
    return result;
  }

  // ─── Find the Inserts tab body ────────────────────────────────────────────────
  // Beckett uses advgb tabs: each tab has a header + a .advgb-tab-body sibling
  // We search all tab bodies for one whose header says "Inserts"
  function findInsertsBodies() {
    const bodies = [];

    // Try advgb tab plugin structure
    const containers = document.querySelectorAll('.advgb-tab-body-container');
    containers.forEach((container) => {
      const header = container.querySelector('.advgb-tab-body-header');
      const body = container.querySelector('.advgb-tab-body');
      if (body && /^inserts$/i.test((header && header.textContent.trim()) || '')) {
        bodies.push(body);
      }
    });

    // Fallback: try all tab bodies, pick any that have section headings with card patterns
    if (bodies.length === 0) {
      document.querySelectorAll('.advgb-tab-body').forEach((body) => {
        if (/[A-Z]+-\d+\s/.test(body.innerText)) bodies.push(body);
      });
    }

    // Last fallback: whole article
    if (bodies.length === 0) {
      const article = document.querySelector('.entry-content, article, main, [class*="post-content"]');
      if (article) bodies.push(article);
    }

    return bodies;
  }

  // ─── Parse insert sections from a container element ──────────────────────────
  // Structure: <h3>Set Name</h3> ... <p>N cards\nHobby – 1:X; ...</p> ... cards
  function parseSections(container) {
    const sections = [];
    const headings = container.querySelectorAll('h2, h3, h4, strong');

    headings.forEach((h) => {
      // Skip nav/meta headings
      const title = h.textContent.trim();
      if (!title || title.length > 80 || /checklist|shop for|parallels/i.test(title)) return;

      // Collect text content until next same-level heading
      const chunks = [];
      let el = h.parentElement === h ? h.nextElementSibling : h.closest('p, h2, h3, h4')?.nextElementSibling;
      // For h2/h3/h4 walk siblings; for <strong> inside <p> walk parent's siblings
      if (h.tagName === 'STRONG') {
        el = h.closest('p')?.nextElementSibling;
      } else {
        el = h.nextElementSibling;
      }

      let safety = 0;
      while (el && safety++ < 30) {
        if (['H2', 'H3', 'H4'].includes(el.tagName)) break;
        chunks.push(el.innerText || el.textContent || '');
        el = el.nextElementSibling;
      }
      const rawText = chunks.join('\n');

      // Parse odds: "Hobby – 1:12 packs; Jumbo – 1:7; Value – 1:17; Mega – 1:14"
      const oddsLine = rawText.match(/(?:Hobby|Jumbo|Value|Mega)[^\n]+/i)?.[0] || '';
      const odds = {};
      oddsLine.replace(/(\w+)\s*[–\-]\s*1:([0-9,]+)/g, (_, type, n) => {
        odds[type] = parseInt(n.replace(/,/g, ''), 10);
      });

      // Parse card list: "XX-1 Player Name, Team" — handles both \n-separated and inline <br>
      const cards = [];
      rawText.split(/\n/).forEach((line) => {
        line.trim().split(/(?=\b[A-Z]+-\d+\s)/).forEach((part) => {
          const m = part.match(/^([A-Z]+-\d+)\s+(.+)/);
          if (m) cards.push({ id: m[1], name: m[2].replace(/\s*\bRC\b\s*/g, '').trim() });
        });
      });

      if (cards.length === 0) return; // not a card set section
      sections.push({ title, odds, cards });
    });

    return sections;
  }

  // ─── Hit rate display ─────────────────────────────────────────────────────────
  function hitRate(oddsPerPack, packsPerBox) {
    if (!oddsPerPack || !packsPerBox) return null;
    const rate = packsPerBox / oddsPerPack;
    if (rate >= 1) return `~${rate.toFixed(1)}x / box`;
    const every = Math.round(1 / rate);
    return `1 per ${every} boxes`;
  }

  // ─── Styles ───────────────────────────────────────────────────────────────────
  function injectStyles() {
    GM_addStyle(`
      #bk-filter-bar {
        position: sticky;
        top: 0;
        z-index: 9999;
        background: #111;
        color: #eee;
        padding: 10px 16px;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        font-family: system-ui, sans-serif;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        border-bottom: 2px solid #e63c14;
      }
      #bk-filter-bar .bk-label { font-weight: 600; color: #e63c14; white-space: nowrap; }
      .bk-btn {
        padding: 5px 14px;
        border-radius: 20px;
        border: 2px solid #555;
        background: transparent;
        color: #ddd;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.15s;
      }
      .bk-btn:hover { border-color: #e63c14; color: #e63c14; }
      .bk-btn.active { background: #e63c14; border-color: #e63c14; color: #fff; }
      .bk-btn.all-btn { border-color: #888; color: #aaa; }
      .bk-btn.all-btn.active { background: #444; border-color: #aaa; color: #fff; }
      #bk-panel {
        position: sticky;
        top: 46px;
        z-index: 9998;
        background: #1a1a1a;
        padding: 14px 16px;
        font-family: system-ui, sans-serif;
        font-size: 13px;
        color: #ccc;
        display: none;
        max-height: 70vh;
        overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        border-bottom: 1px solid #333;
      }
      #bk-panel.visible { display: block; }
      #bk-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 14px;
        color: #aaa;
        font-size: 13px;
      }
      .bk-close {
        background: none;
        border: none;
        color: #666;
        font-size: 18px;
        cursor: pointer;
        line-height: 1;
        padding: 0 4px;
      }
      .bk-close:hover { color: #fff; }
      .bk-set {
        margin-bottom: 20px;
        border-left: 3px solid #e63c14;
        padding-left: 12px;
      }
      .bk-set-title {
        font-size: 15px;
        font-weight: 700;
        color: #fff;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .bk-hit-rate {
        background: #1e3a1e;
        border: 1px solid #2e6b2e;
        border-radius: 4px;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 600;
        color: #4caf50;
      }
      .bk-set-meta {
        font-size: 12px;
        color: #777;
        margin-bottom: 8px;
      }
      .bk-cards {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .bk-chip {
        background: #252525;
        border: 1px solid #333;
        border-radius: 4px;
        padding: 3px 8px;
        font-size: 12px;
        color: #ddd;
        white-space: nowrap;
      }
      .bk-chip-id { color: #666; margin-right: 4px; }
      .bk-no-odds { color: #888; font-style: italic; font-size: 12px; }
    `);
  }

  // ─── Build UI ─────────────────────────────────────────────────────────────────
  function buildUI(sections, boxPacks) {
    injectStyles();

    // Determine available box types from actual odds data + box packs
    const boxTypes = ['Hobby', 'Jumbo', 'Value', 'Mega'].filter(
      (t) => Object.keys(boxPacks).includes(t) || sections.some((s) => s.odds[t] != null)
    );
    const hasOdds = sections.some((s) => Object.keys(s.odds).length > 0);

    // Bar
    const bar = document.createElement('div');
    bar.id = 'bk-filter-bar';
    bar.innerHTML = `<span class="bk-label">📦 Box Filter</span>`;

    const allBtn = document.createElement('button');
    allBtn.className = 'bk-btn all-btn active';
    allBtn.textContent = 'All';
    bar.appendChild(allBtn);

    if (boxTypes.length > 0) {
      boxTypes.forEach((type) => {
        const btn = document.createElement('button');
        btn.className = 'bk-btn';
        btn.textContent = type;
        btn.dataset.type = type;
        bar.appendChild(btn);
      });
    } else if (!hasOdds) {
      // No odds at all — show "Show Cards" button
      const btn = document.createElement('button');
      btn.className = 'bk-btn';
      btn.textContent = 'Show All Inserts';
      btn.dataset.type = 'all-inserts';
      bar.appendChild(btn);
    }

    // Panel
    const panel = document.createElement('div');
    panel.id = 'bk-panel';

    document.body.prepend(panel);
    document.body.prepend(bar);

    function setActive(target) {
      bar.querySelectorAll('.bk-btn').forEach((b) => b.classList.remove('active'));
      target.classList.add('active');
    }

    allBtn.onclick = () => {
      setActive(allBtn);
      panel.classList.remove('visible');
    };

    bar.querySelectorAll('.bk-btn[data-type]').forEach((btn) => {
      btn.onclick = () => {
        setActive(btn);
        renderPanel(btn.dataset.type);
      };
    });

    function renderPanel(boxType) {
      panel.innerHTML = '';

      const headerDiv = document.createElement('div');
      headerDiv.id = 'bk-panel-header';

      let matching;
      let summaryText;

      if (boxType === 'all-inserts') {
        matching = sections;
        summaryText = `<strong style="color:#fff">${matching.length}</strong> insert sets (no pack odds on this page)`;
      } else {
        matching = sections.filter((s) => s.odds[boxType] != null);
        const packs = boxPacks[boxType];
        summaryText = `<strong style="color:#fff">${boxType}</strong> box`;
        if (packs) summaryText += ` — ${packs} packs/box`;
        summaryText += ` · <strong style="color:#fff">${matching.length}</strong> insert sets available`;
        if (matching.length < sections.length) {
          summaryText += ` <span style="color:#555">(${sections.length - matching.length} sets not in ${boxType})</span>`;
        }
      }

      headerDiv.innerHTML = `<div>${summaryText}</div>`;
      const closeBtn = document.createElement('button');
      closeBtn.className = 'bk-close';
      closeBtn.textContent = '✕';
      closeBtn.onclick = () => {
        panel.classList.remove('visible');
        setActive(allBtn);
      };
      headerDiv.appendChild(closeBtn);
      panel.appendChild(headerDiv);

      if (matching.length === 0) {
        panel.innerHTML += `<div style="color:#666;padding:8px 0">No inserts found for <strong style="color:#aaa">${boxType}</strong> boxes on this page.</div>`;
        panel.classList.add('visible');
        return;
      }

      matching.forEach((s) => {
        const oddsPerPack = s.odds[boxType];
        const packs = boxPacks[boxType];
        const rate = hitRate(oddsPerPack, packs);

        const setEl = document.createElement('div');
        setEl.className = 'bk-set';

        const titleRow = document.createElement('div');
        titleRow.className = 'bk-set-title';
        titleRow.textContent = s.title;
        if (rate) {
          const rateChip = document.createElement('span');
          rateChip.className = 'bk-hit-rate';
          rateChip.textContent = rate;
          titleRow.appendChild(rateChip);
        }

        const meta = document.createElement('div');
        meta.className = 'bk-set-meta';
        if (oddsPerPack) {
          meta.textContent = `1:${oddsPerPack.toLocaleString()} packs · ${s.cards.length} cards`;
        } else {
          meta.textContent = `${s.cards.length} cards`;
        }

        const cardsEl = document.createElement('div');
        cardsEl.className = 'bk-cards';
        s.cards.forEach((c) => {
          const chip = document.createElement('div');
          chip.className = 'bk-chip';
          chip.innerHTML = `<span class="bk-chip-id">${c.id}</span>${c.name}`;
          cardsEl.appendChild(chip);
        });

        setEl.appendChild(titleRow);
        setEl.appendChild(meta);
        setEl.appendChild(cardsEl);
        panel.appendChild(setEl);
      });

      panel.classList.add('visible');
      panel.scrollTop = 0;
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    const boxPacks = parseBoxPacks();
    const bodies = findInsertsBodies();
    if (bodies.length === 0) return;

    const sections = [];
    bodies.forEach((body) => {
      parseSections(body).forEach((s) => sections.push(s));
    });

    if (sections.length === 0) return;
    buildUI(sections, boxPacks);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
