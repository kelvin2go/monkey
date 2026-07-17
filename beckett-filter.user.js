// ==UserScript==
// @name         Beckett Card Filter
// @namespace    https://github.com/kelvin2go/card-script
// @version      1.0.0
// @description  Filter inserts by box type and show hit rates on Beckett checklist pages
// @author       kelvin2go
// @match        https://www.beckett.com/news/*
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Box config: packs per box by type ───────────────────────────────────────
  const BOX_PACKS = parseBoxPacks();

  function parseBoxPacks() {
    const text = document.body.innerText;
    // e.g. "Packs per box: Hobby – 4; Jumbo – 4; Value – 6; Mega – 10"
    const m = text.match(/Packs per box[:\s]+([^\n]+)/i);
    if (!m) return { Hobby: 4, Jumbo: 4, Value: 6, Mega: 10 }; // fallback
    const result = {};
    m[1].replace(/(\w+)\s*[–-]\s*(\d+)/g, (_, type, n) => {
      result[type] = parseInt(n, 10);
    });
    return result;
  }

  // ─── Parse insert sections ────────────────────────────────────────────────────
  // Each section looks like:
  //   <h3>After Image</h3>
  //   <p>25 cards\nHobby – 1:12 packs; Jumbo – 1:7; Value – 1:17; Mega – 1:14</p>
  //   card list...

  function parseInsertSections() {
    const sections = [];
    // Find all h3/h4 headings inside the article content
    const content = document.querySelector('.entry-content, article, main, .post-content')
      || document.body;

    const headings = [...content.querySelectorAll('h3, h4, h2')];

    headings.forEach((h) => {
      const title = h.textContent.trim();
      if (!title || title.length > 80) return;

      // Collect sibling nodes until next same-level heading
      const nodes = [];
      let el = h.nextElementSibling;
      while (el && !['H2', 'H3', 'H4'].includes(el.tagName)) {
        nodes.push(el);
        el = el.nextElementSibling;
      }

      const rawText = nodes.map((n) => n.innerText || n.textContent).join('\n');

      // Parse odds line: "Hobby – 1:12 packs; Jumbo – 1:7; Value – 1:17; Mega – 1:14"
      const oddsLine = rawText.match(/(?:Hobby|Jumbo|Value|Mega)[^;\n]+(?:;[^;\n]+)*/i)?.[0] || '';
      const odds = {};
      oddsLine.replace(/(\w+)\s*[–-]\s*1:([0-9,]+)/g, (_, type, n) => {
        odds[type] = parseInt(n.replace(/,/g, ''), 10);
      });

      if (Object.keys(odds).length === 0) return; // not an insert section with odds

      // Parse card list: lines matching "XX-N Player, Team"
      const cards = [];
      rawText.split('\n').forEach((line) => {
        const m = line.match(/^([A-Z]+-\d+)\s+(.+)/);
        if (m) cards.push({ id: m[1], name: m[2].trim() });
      });

      sections.push({ title, odds, cards, el: h, nodes });
    });

    return sections;
  }

  // ─── Hit rate: expected hits per box ─────────────────────────────────────────
  function hitRate(oddsPerPack, packsPerBox) {
    if (!oddsPerPack || !packsPerBox) return null;
    const rate = packsPerBox / oddsPerPack;
    if (rate >= 1) return `~${rate.toFixed(1)}x / box`;
    const every = Math.round(1 / rate);
    return `1 / ${every} boxes`;
  }

  // ─── Build UI ─────────────────────────────────────────────────────────────────
  function buildUI(sections) {
    const BOX_TYPES = Object.keys(BOX_PACKS).length
      ? Object.keys(BOX_PACKS)
      : ['Hobby', 'Jumbo', 'Value', 'Mega'];

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
      #bk-filter-bar span { font-weight: 600; color: #e63c14; }
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
      #bk-filter-results {
        position: sticky;
        top: 48px;
        z-index: 9998;
        background: #1a1a1a;
        padding: 12px 16px;
        font-family: system-ui, sans-serif;
        font-size: 13px;
        color: #ccc;
        display: none;
        max-height: 70vh;
        overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        border-bottom: 1px solid #333;
      }
      #bk-filter-results.visible { display: block; }
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
      }
      .bk-set-meta {
        font-size: 12px;
        color: #888;
        margin-bottom: 8px;
      }
      .bk-hit-rate {
        display: inline-block;
        background: #2a2a2a;
        border: 1px solid #444;
        border-radius: 4px;
        padding: 2px 8px;
        font-size: 12px;
        font-weight: 600;
        color: #4caf50;
        margin-left: 8px;
      }
      .bk-cards {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .bk-card-chip {
        background: #2a2a2a;
        border: 1px solid #333;
        border-radius: 4px;
        padding: 3px 8px;
        font-size: 12px;
        color: #ddd;
        white-space: nowrap;
      }
      .bk-card-chip .bk-card-id {
        color: #888;
        margin-right: 4px;
      }
      .bk-close {
        margin-left: auto;
        background: none;
        border: none;
        color: #888;
        font-size: 18px;
        cursor: pointer;
        line-height: 1;
      }
      .bk-close:hover { color: #fff; }
      .bk-summary {
        font-size: 12px;
        color: #888;
        margin-left: 4px;
      }
    `);

    // Filter bar
    const bar = document.createElement('div');
    bar.id = 'bk-filter-bar';
    bar.innerHTML = `<span>📦 Box Filter</span>`;

    const allBtn = document.createElement('button');
    allBtn.className = 'bk-btn all-btn active';
    allBtn.textContent = 'All';
    bar.appendChild(allBtn);

    BOX_TYPES.forEach((type) => {
      const btn = document.createElement('button');
      btn.className = 'bk-btn';
      btn.textContent = type;
      btn.dataset.boxType = type;
      bar.appendChild(btn);
    });

    // Results panel
    const panel = document.createElement('div');
    panel.id = 'bk-filter-results';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'bk-close';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => {
      panel.classList.remove('visible');
      setActive(allBtn);
    };

    document.body.prepend(panel);
    document.body.prepend(bar);

    // ─── Active state helper ────────────────────────────────────────────────
    function setActive(target) {
      bar.querySelectorAll('.bk-btn').forEach((b) => b.classList.remove('active'));
      target.classList.add('active');
    }

    allBtn.onclick = () => {
      setActive(allBtn);
      panel.classList.remove('visible');
    };

    bar.querySelectorAll('.bk-btn[data-box-type]').forEach((btn) => {
      btn.onclick = () => {
        setActive(btn);
        renderPanel(btn.dataset.boxType);
      };
    });

    // ─── Render filtered panel ──────────────────────────────────────────────
    function renderPanel(boxType) {
      const packsPerBox = BOX_PACKS[boxType];
      const matching = sections.filter((s) => s.odds[boxType] != null);

      panel.innerHTML = '';
      panel.appendChild(closeBtn);

      if (matching.length === 0) {
        panel.innerHTML += `<div style="color:#888;padding:12px">No inserts found for <strong>${boxType}</strong> boxes.</div>`;
        panel.classList.add('visible');
        return;
      }

      const summary = document.createElement('div');
      summary.style.cssText = 'margin-bottom:14px;color:#aaa;font-size:13px;';
      summary.innerHTML = `<strong style="color:#fff">${boxType} box</strong> — ${packsPerBox} packs/box · <strong style="color:#fff">${matching.length}</strong> insert sets available`;
      panel.appendChild(summary);

      matching.forEach((s) => {
        const oddsPerPack = s.odds[boxType];
        const rate = hitRate(oddsPerPack, packsPerBox);

        const setEl = document.createElement('div');
        setEl.className = 'bk-set';

        const titleRow = document.createElement('div');
        titleRow.className = 'bk-set-title';
        titleRow.innerHTML = `${s.title}`;
        if (rate) titleRow.innerHTML += `<span class="bk-hit-rate">${rate}</span>`;

        const meta = document.createElement('div');
        meta.className = 'bk-set-meta';
        meta.textContent = `1:${oddsPerPack.toLocaleString()} packs · ${s.cards.length} cards`;

        const cardsEl = document.createElement('div');
        cardsEl.className = 'bk-cards';
        s.cards.forEach((c) => {
          const chip = document.createElement('div');
          chip.className = 'bk-card-chip';
          chip.innerHTML = `<span class="bk-card-id">${c.id}</span>${c.name}`;
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
    const sections = parseInsertSections();
    if (sections.length === 0) return; // not a checklist page
    buildUI(sections);
  }

  // Run after DOM settles
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
