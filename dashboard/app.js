/* Token Radar — dashboard logic.
 * Single source of truth: window.RADAR (data.js, written by main.ts from
 * lib/model.ts). No protocol data is hardcoded here; the model panel reads
 * RADAR.model and RADAR.stats, the tables read RADAR.board / RADAR.live,
 * and the detail view reads each row's own breakdown and farm_steps.
 * No network: no fetch, no external resources, no links out.
 */
(function () {
  "use strict";

  var R = window.RADAR || null;

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return "—";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n);
  }
  function fmtUsdFull(n) {
    if (n == null || !isFinite(n)) return "—";
    return "$" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function fmtPct(v) {
    if (v == null || !isFinite(v)) return '<span class="na">n/a</span>';
    var cls = v > 0 ? "pos" : v < 0 ? "neg" : "";
    var sign = v > 0 ? "+" : "";
    return '<span class="' + cls + '">' + sign + v.toFixed(1) + "%</span>";
  }
  function fmtAge(days, unknown) {
    if (days == null) return "—";
    var t = days < 365 ? days + "d" : (days / 365).toFixed(1) + "y";
    return unknown ? "≈" + t : t;
  }
  function fmtFactor(f) { return "×" + f.toFixed(3); }
  function clampPct(x) { return Math.max(3, Math.min(100, x)); }

  /* ---------------- state ---------------- */
  var state = {
    tab: "pre", q: "", cat: "", chain: "", wlOnly: false,
    sortKey: "rank", sortDir: 1, detailSlug: null
  };
  var SORT_DEFAULT_DIR = { rank: 1, name: 1, tvl_usd: -1, implied_value_usd: -1, change_7d: -1, age_days: -1, chains: -1 };

  /* ---------------- data access ---------------- */
  function board() { return (R && R.board) || []; }
  function live() { return (R && R.live) || []; }

  function matches(row) {
    if (state.wlOnly && row.section !== "watchlist") return false;
    if (state.cat && (row.category || "Unknown") !== state.cat) return false;
    if (state.chain && row.chains.indexOf(state.chain) === -1) return false;
    if (state.q) {
      var q = state.q.toLowerCase();
      if (row.name.toLowerCase().indexOf(q) === -1 && row.slug.toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  }

  function sortVal(row, key) {
    if (key === "chains") return row.chains.length * 1000 + (row.chains[0] || "").charCodeAt(0) / 1000;
    if (key === "name") return row.name.toLowerCase();
    return row[key];
  }
  function sortRows(rows) {
    var key = state.sortKey, dir = state.sortDir;
    return rows.slice().sort(function (a, b) {
      var av = sortVal(a, key), bv = sortVal(b, key);
      if (av == null && bv == null) return a.rank - b.rank;
      if (av == null) return 1;   /* nulls always last */
      if (bv == null) return -1;
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.rank - b.rank;
    });
  }

  /* ---------------- rendering: chrome ---------------- */
  function renderChips() {
    var s = R.stats || {};
    var chips = [];
    chips.push("Snapshot <b>" + esc(R.as_of || "—") + "</b>");
    chips.push("<b class='num'>" + board().length + "</b> rows on the board");
    chips.push("<b class='num'>" + (s.watchlist_total || 0) + "</b> watchlist");
    chips.push("<b class='num'>" + (s.early_in_board || 0) + "</b> early finds");
    chips.push("Total implied <b class='num'>" + fmtUsd(s.board_total_implied_usd) + "</b>");
    chips.push("Median implied <b class='num'>" + fmtUsd(s.board_median_implied_usd) + "</b>");
    if (s.live_median_mcap_tvl_ratio != null) {
      chips.push("Live anchor mcap/TVL <b class='num'>" + s.live_median_mcap_tvl_ratio.toFixed(3) + "</b>");
    }
    $("chips").innerHTML = chips.map(function (c) { return '<span class="chip">' + c + "</span>"; }).join("");
    $("footMeta").textContent =
      "Snapshot " + (R.as_of || "—") + " · floor " + fmtUsdFull(R.floor_usd) +
      " · " + board().length + " board rows · " + live().length + " live rows";
  }

  function fillOptions() {
    var cats = {}, chains = {};
    board().forEach(function (r) {
      cats[r.category || "Unknown"] = 1;
      r.chains.forEach(function (c) { chains[c] = 1; });
    });
    var catSel = $("cat"), chainSel = $("chain");
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement("option"); o.value = c; o.textContent = c; catSel.appendChild(o);
    });
    Object.keys(chains).sort().forEach(function (c) {
      var o = document.createElement("option"); o.value = c; o.textContent = c; chainSel.appendChild(o);
    });
  }

  /* ---------------- rendering: tables ---------------- */
  function rowHtml(r) {
    var badge = r.section === "watchlist"
      ? '<span class="badge wl">Watchlist</span>'
      : '<span class="badge early">Early</span>';
    var chains = r.chains.map(function (c) { return '<span class="tag">' + esc(c) + "</span>"; }).join("");
    return "<tr tabindex='0' data-slug='" + esc(r.slug) + "'>" +
      "<td class='rank'>" + r.rank + "</td>" +
      "<td class='name'>" + esc(r.name) + badge + "<span class='slug'>" + esc(r.slug) + "</span></td>" +
      "<td>" + fmtUsd(r.tvl_usd) + "</td>" +
      "<td class='impl'>" + fmtUsd(r.implied_value_usd) + "</td>" +
      "<td>" + fmtPct(r.change_7d) + "</td>" +
      "<td>" + fmtAge(r.age_days, r.age_unknown) + "</td>" +
      "<td class='chains'>" + chains + "</td>" +
      "<td>" + esc(r.category || "—") + "</td></tr>";
  }

  function renderBoard() {
    var wl = sortRows(board().filter(function (r) { return r.section === "watchlist" && matches(r); }));
    var early = sortRows(board().filter(function (r) { return r.section === "early" && matches(r); }));
    $("wlBody").innerHTML = wl.map(rowHtml).join("");
    $("earlyBody").innerHTML = early.map(rowHtml).join("");
    $("wlCount").textContent = "· " + wl.length + " shown";
    $("earlyCount").textContent = "· " + early.length + " shown";
    $("earlySec").style.display = state.wlOnly ? "none" : "";
    var total = board().filter(matches).length;
    $("countLine").textContent = state.wlOnly
      ? "Watchlist only: showing " + wl.length + " of 40 watchlist protocols."
      : "Showing " + total + " of " + board().length + " board rows — " + wl.length + " watchlist, " + early.length + " early.";
    $("emptyPre").hidden = total !== 0;
    markSortHeaders();
  }

  function renderLive() {
    $("liveBody").innerHTML = live().map(function (r, i) {
      return "<tr tabindex='0' data-slug='" + esc(r.slug) + "'>" +
        "<td class='rank'>" + (i + 1) + "</td>" +
        "<td class='name'>" + esc(r.name) + "<span class='slug'>" + esc(r.slug) + "</span></td>" +
        "<td>" + esc(r.symbol || "—") + "</td>" +
        "<td class='impl'>" + fmtUsd(r.mcap_usd) + "</td>" +
        "<td>" + fmtUsd(r.tvl_usd) + "</td>" +
        "<td>" + r.mcap_tvl_ratio.toFixed(2) + "×</td>" +
        "<td>" + esc(r.category || "—") + "</td></tr>";
    }).join("");
  }

  function markSortHeaders() {
    document.querySelectorAll("th[data-sort]").forEach(function (th) {
      th.removeAttribute("aria-sort");
      var arr = th.querySelector(".arr");
      if (arr) arr.remove();
      if (th.getAttribute("data-sort") === state.sortKey) {
        th.setAttribute("aria-sort", state.sortDir === 1 ? "ascending" : "descending");
        var s = document.createElement("span");
        s.className = "arr";
        s.textContent = state.sortDir === 1 ? "▲" : "▼";
        th.appendChild(s);
      }
    });
  }

  /* ---------------- rendering: model panel ---------------- */
  function renderModel() {
    var m = R.model || {};
    $("modelFormula").textContent = m.formula || "implied = K × TVL^0.85 × growth × age × chain × category";
    var s = R.stats || {};
    var cal = s.calibration || {};
    var cells = [
      ["K — calibrated constant", m.k != null ? m.k.toFixed(2) : "—",
       "Maps the median watchlist protocol to the live-token anchor."],
      ["TVL exponent", m.tvl_exponent != null ? String(m.tvl_exponent) : "—",
       "Sub-linear: giants do not eat the board."],
      ["Growth weight", m.growth_weight != null ? String(m.growth_weight) + " per point" : "—",
       "7-day change clamped to " + (m.growth_clamp ? m.growth_clamp[0] + "% … +" + m.growth_clamp[1] + "%" : "−60% … +120%") +
       ", factor clamped to 0.55–1.90. Unreported change counts as neutral (1.00)."],
      ["Age curve", "saturates ~" + (m.age_saturation_days || 730) + " days",
       "Rises fast, peaks near two years, then a “never launched” discount of up to 10%. Unknown listing date counts as 365 days."],
      ["Chain factor", "+0.04 per extra chain, cap " + (m.chain_cap != null ? m.chain_cap.toFixed(2) : "1.20"),
       "Single-chain 1.00; six or more chains capped."],
      ["Category factor", "1.06 − 0.9 × share",
       "Computed from the snapshot at run time, clamped 0.92–1.08. Crowded categories are discounted; no category is hand-picked."],
      ["Live anchor", cal.anchor_mcap_tvl_median != null ? cal.anchor_mcap_tvl_median.toFixed(3) : "—",
       "Median mcap/TVL among live-token protocols. Target median watchlist implied: " +
       fmtUsd(cal.anchor_target_median_implied_usd) + "."],
      ["Median watchlist TVL", fmtUsd(cal.median_watchlist_tvl_usd),
       "The anchor target is 0.214 × this TVL. Model median implied: " + fmtUsd(s.watchlist_median_implied_usd) + "."]
    ];
    $("modelGrid").innerHTML = cells.map(function (c) {
      return '<div class="cell"><div class="k">' + esc(c[0]) + '</div><div class="v">' + esc(c[1]) +
        '</div><div class="d">' + esc(c[2]) + "</div></div>";
    }).join("");
  }

  /* ---------------- detail view ---------------- */
  function findRow(slug) {
    for (var i = 0; i < board().length; i++) if (board()[i].slug === slug) return board()[i];
    return null;
  }

  function bdRow(label, value, pct) {
    return '<div class="bd-row"><span class="bl">' + esc(label) + '</span>' +
      '<span class="bv">' + value + '</span>' +
      '<span class="bar"><i style="width:' + clampPct(pct) + '%"></i></span></div>';
  }

  function renderDetail(row) {
    var b = row.breakdown || {};
    var implied = row.implied_value_usd;
    var bars = "";
    bars += bdRow("TVL base — K × TVL^0.85", fmtUsd(b.tvl_base_usd),
      (b.tvl_base_usd && implied) ? b.tvl_base_usd / implied * 100 : 0);
    bars += bdRow("Growth factor", b.growth_factor != null ? fmtFactor(b.growth_factor) : "—",
      (b.growth_factor || 1) / 1.9 * 100);
    bars += bdRow("Age factor", b.age_factor != null ? fmtFactor(b.age_factor) : "—",
      (b.age_factor || 1) * 100);
    bars += bdRow("Chain factor", b.chain_factor != null ? fmtFactor(b.chain_factor) : "—",
      (b.chain_factor || 1) / 1.2 * 100);
    bars += bdRow("Category factor", b.category_factor != null ? fmtFactor(b.category_factor) : "—",
      (b.category_factor || 1) / 1.08 * 100);
    var steps = (row.farm_steps || []).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    var chg = row.change_7d == null ? "not reported"
      : row.change_7d.toFixed(2) + "% (clamped to " +
        (b.change_7d_clamped == null ? "—" : b.change_7d_clamped.toFixed(2) + "%") + ")";
    $("detailBody").innerHTML =
      "<h2>" + esc(row.name) + "</h2>" +
      '<p class="slugline">' + esc(row.slug) + " · rank #" + row.rank + " · " +
      (row.section === "watchlist" ? "Watchlist" : "Early find") +
      " · records no token</p>" +
      '<div class="kv">' +
      "<div class='cell'><div class='k'>TVL</div><div class='v'>" + fmtUsdFull(row.tvl_usd) + "</div></div>" +
      "<div class='cell'><div class='k'>7-day change</div><div class='v'>" + esc(chg) + "</div></div>" +
      "<div class='cell'><div class='k'>Age</div><div class='v'>" + fmtAge(row.age_days, row.age_unknown) +
        (row.age_unknown ? " — listing date unknown, 365 days assumed" : "") + "</div></div>" +
      "<div class='cell'><div class='k'>Chains</div><div class='v'>" + esc(row.chains.join(", ") || "—") + "</div></div>" +
      "<div class='cell'><div class='k'>Category</div><div class='v'>" + esc(row.category || "—") + "</div></div>" +
      "<div class='cell'><div class='k'>Token status</div><div class='v'>Records no token</div></div>" +
      "</div>" +
      "<h3>Model breakdown</h3>" + bars +
      '<div class="bd-total"><span class="t">Implied value</span><span class="n">' + fmtUsdFull(implied) + "</span></div>" +
      '<p class="note">TVL base × growth × age × chain × category = implied value. ' +
      "Each factor comes from this protocol's own snapshot figures; nothing is a hand-picked name.</p>" +
      "<h3>How to farm it</h3>" +
      '<ol class="steps">' + steps + "</ol>" +
      '<p class="note">Implied value is this entry\u2019s own claim, not a prediction that a token will be issued, or when.</p>';
  }

  function openDetail(slug) {
    var row = findRow(slug);
    if (!row) return;
    state.detailSlug = slug;
    renderDetail(row);
    $("detail").hidden = false;
    $("overlay").hidden = false;
    document.body.style.overflow = "hidden";
    writeHash();
    $("detailClose").focus();
  }
  function closeDetail() {
    state.detailSlug = null;
    $("detail").hidden = true;
    $("overlay").hidden = true;
    document.body.style.overflow = "";
    writeHash();
  }

  /* ---------------- tabs / deep links ---------------- */
  function setTab(tab) {
    state.tab = tab;
    $("tabPre").classList.toggle("on", tab === "pre");
    $("tabLive").classList.toggle("on", tab === "live");
    $("tabPre").setAttribute("aria-selected", tab === "pre" ? "true" : "false");
    $("tabLive").setAttribute("aria-selected", tab === "live" ? "true" : "false");
    $("boardView").hidden = tab !== "pre";
    $("liveView").hidden = tab !== "live";
    if (tab === "live") renderLive();
  }

  function parseHash() {
    var h = location.hash.replace(/^#/, "");
    var out = {};
    h.split("&").forEach(function (part) {
      var kv = part.split("=");
      if (kv[0]) out[kv[0]] = decodeURIComponent(kv[1] || "");
    });
    return out;
  }
  function writeHash() {
    var parts = [];
    if (state.q) parts.push("q=" + encodeURIComponent(state.q));
    if (state.detailSlug) parts.push("p=" + encodeURIComponent(state.detailSlug));
    var h = parts.join("&");
    try {
      history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
    } catch (e) { /* file:// or restricted context: hash stays as-is */ }
  }
  function applyHash() {
    var h = parseHash();
    if (h.q != null && h.q !== state.q) {
      state.q = h.q;
      $("q").value = h.q;
    }
    if (h.p) openDetail(h.p);
  }

  /* ---------------- events ---------------- */
  function bind() {
    $("tabPre").addEventListener("click", function () { setTab("pre"); });
    $("tabLive").addEventListener("click", function () { setTab("live"); });
    $("q").addEventListener("input", function (e) {
      state.q = e.target.value.trim();
      renderBoard();
      writeHash();
    });
    $("cat").addEventListener("change", function (e) { state.cat = e.target.value; renderBoard(); });
    $("chain").addEventListener("change", function (e) { state.chain = e.target.value; renderBoard(); });
    $("wlOnly").addEventListener("change", function (e) { state.wlOnly = e.target.checked; renderBoard(); });

    document.querySelectorAll("th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sort");
        if (state.sortKey === key) {
          state.sortDir = -state.sortDir;
        } else {
          state.sortKey = key;
          state.sortDir = SORT_DEFAULT_DIR[key] || -1;
        }
        renderBoard();
      });
    });

    document.querySelectorAll("tbody").forEach(function (tb) {
      tb.addEventListener("click", function (e) {
        var tr = e.target.closest("tr");
        if (tr && tr.getAttribute("data-slug")) openDetail(tr.getAttribute("data-slug"));
      });
      tb.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        var tr = e.target.closest("tr");
        if (tr && tr.getAttribute("data-slug")) {
          e.preventDefault();
          openDetail(tr.getAttribute("data-slug"));
        }
      });
    });

    $("detailClose").addEventListener("click", closeDetail);
    $("overlay").addEventListener("click", closeDetail);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.detailSlug) closeDetail();
    });
    window.addEventListener("hashchange", applyHash);
  }

  /* ---------------- init ---------------- */
  function init() {
    if (!R || !Array.isArray(R.board) || R.board.length === 0) {
      $("countLine").textContent = "No radar data loaded — data.js (window.RADAR) is missing or empty.";
      $("chips").innerHTML = "";
      return;
    }
    fillOptions();
    renderChips();
    renderModel();
    bind();
    applyHash();
    renderBoard();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
