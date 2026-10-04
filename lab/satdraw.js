/* LELP-1 lab site: a to-scale side view of a dedicated free-flyer, drawn from its sizing numbers.
   window.LelpSatDraw(d) -> SVG string. d: { name, arch ('A'|'B'|'C'), capD, capKg, wetKg, busKg, arrayM2, arrayW, battWh,
   nThr, xband, furnace, centrifuge, lit, retKg, form }. Geometry rules match .kiro/specs/satellite-cad/design.md; they are
   concept geometry, not a CAD baseline. Used by the experiment pages, satellites.html and the configurator. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f1 = (x) => Number(x).toFixed(1), f2 = (x) => Number(x).toFixed(2), f0 = (x) => Math.round(x);
  const W = 640, H = 400, PADL = 24, PADR = 196, PADT = 30, PADB = 64;          // drawing area left of the callout list

  function geometry(d) {
    if (d.arch === 'A') return { cube: true, bx: 0.226, bz: 0.366, wingL: 0.34, wingW: 0.226 };
    const bodyD = Math.max(0.35, 0.42 * d.capD), hc = 0.55 * bodyD, band = 0.12;
    const s = Math.max(0.5, bodyD + 0.1), hb = Math.min(1.1, Math.max(0.35, d.busKg / 300 / (s * s)));
    const aw = d.arrayM2 / 2 / 0.85, L = Math.sqrt(2 * aw), Wd = Math.sqrt(aw / 2);
    const coneH = Math.tan(20 * Math.PI / 180) * (d.capD - bodyD) / 2 + 0.06;
    return { bodyD, hc, band, s, hb, L, Wd, coneH, yoke: 0.08 };
  }

  function dimH(x1, x2, y, label) {      // horizontal dimension line with end ticks
    return `<g class="dim"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><line x1="${x1}" y1="${y - 5}" x2="${x1}" y2="${y + 5}"/><line x1="${x2}" y1="${y - 5}" x2="${x2}" y2="${y + 5}"/>
      <text x="${(x1 + x2) / 2}" y="${y - 6}" text-anchor="middle">${esc(label)}</text></g>`;
  }
  function dimV(x, y1, y2, label) {
    return `<g class="dim"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><line x1="${x - 5}" y1="${y1}" x2="${x + 5}" y2="${y1}"/><line x1="${x - 5}" y1="${y2}" x2="${x + 5}" y2="${y2}"/>
      <text x="${x - 6}" y="${(y1 + y2) / 2}" text-anchor="end" dominant-baseline="middle">${esc(label)}</text></g>`;
  }
  const bubble = (k, x, y) => `<g class="bub"><circle cx="${x}" cy="${y}" r="8"/><text x="${x}" y="${y + 0.5}" text-anchor="middle" dominant-baseline="middle">${k}</text></g>`;

  function draw(d) {
    const g = geometry(d), parts = [], call = [];
    const areaW = W - PADL - PADR, areaH = H - PADT - PADB;
    if (g.cube) {                                   // 6U CubeSat with two deployable panels
      const totW = g.bx + 2 * g.wingL + 0.04, totH = g.bz;
      const k = Math.min(areaW / totW, areaH / totH) * 0.8, cx = PADL + areaW / 2, top = PADT + (areaH - totH * k) / 2;
      const bw = g.bx * k, bh = g.bz * k, x0 = cx - bw / 2;
      parts.push(`<rect class="bus" x="${x0}" y="${top}" width="${bw}" height="${bh}" rx="3"/>`);
      for (let i = 1; i < 6; i++) parts.push(`<line class="seam" x1="${x0}" y1="${top + bh * i / 6}" x2="${x0 + bw}" y2="${top + bh * i / 6}"/>`);
      const ww = g.wingL * k, wh = g.wingW * k;
      parts.push(`<rect class="wing" x="${x0 - ww - 4}" y="${top + bh * 0.2}" width="${ww}" height="${wh}"/><rect class="wing" x="${x0 + bw + 4}" y="${top + bh * 0.2}" width="${ww}" height="${wh}"/>`);
      parts.push(dimV(x0 - ww - 14, top, top + bh, '36.6 cm'), dimH(x0, x0 + bw, top + bh + 18, '22.6 cm'));
      parts.push(bubble(1, x0 + bw / 2, top + bh * 0.5), bubble(2, x0 + bw + 4 + ww / 2, top + bh * 0.2 + wh / 2));
      call.push(['1', `${d.form || '6U CubeSat'}: fluidic wells and LED/photodiode readout`], ['2', 'deployable solar panels'], ['', 'no return: results are downlinked']);
    } else {
      const totW = Math.max(g.s + 2 * (g.yoke + g.L), d.capD), totH = g.coneH + g.band + g.hc + g.hb + 0.16;
      const k = Math.min(areaW / totW, areaH / totH), cx = PADL + areaW / 2;
      parts.push(`<g class="dim"><line x1="${PADL}" y1="${H - 54}" x2="${PADL + 0.5 * k}" y2="${H - 54}" stroke-width="3"/><text x="${PADL}" y="${H - 59}">0.5 m</text></g>`);
      let y = PADT + (areaH - totH * k) / 2 + g.coneH * k;                    // top of the packed heat shield
      // inflated heat shield outline (it inflates only before entry)
      const rD = d.capD / 2 * k, rb = g.bodyD / 2 * k;
      parts.push(`<path class="hiad-out" d="M${cx - rD} ${y} L${cx - rb} ${y - g.coneH * k + 0.06 * k} Q${cx} ${y - g.coneH * k - 4} ${cx + rb} ${y - g.coneH * k + 0.06 * k} L${cx + rD} ${y}"/>`);
      parts.push(dimH(cx - rD, cx + rD, y - g.coneH * k - 12, `Ø ${f2(d.capD)} m inflated`));
      // packed heat shield (stacked tori) and the capsule body
      const bandW = (g.bodyD + 0.1) * k, bh = g.band * k;
      parts.push(`<rect class="hiad" x="${cx - bandW / 2}" y="${y}" width="${bandW}" height="${bh}" rx="${bh / 2}"/>`);
      for (let i = 1; i < 4; i++) parts.push(`<line class="tori" x1="${cx - bandW / 2 + 4}" y1="${y + bh * i / 4}" x2="${cx + bandW / 2 - 4}" y2="${y + bh * i / 4}"/>`);
      y += bh;
      const cw = g.bodyD * k, ch = g.hc * k;
      parts.push(`<path class="capsule" d="M${cx - cw / 2} ${y} L${cx + cw / 2} ${y} L${cx + cw * 0.42} ${y + ch} L${cx - cw * 0.42} ${y + ch} Z"/>`);
      // what rides home: cassettes in the drawer (B) or the culture system (C)
      const nb = d.arch === 'C' ? 3 : Math.max(1, Math.min(4, Math.round(d.retKg / 0.7)));
      for (let i = 0; i < nb; i++) parts.push(`<rect class="${d.arch === 'C' ? 'live' : 'cass'}" x="${cx - nb * 9 + i * 18 + 2}" y="${y + ch * 0.35}" width="14" height="${ch * 0.3}" rx="2"/>`);
      if (d.arch === 'B') parts.push(`<line class="window" x1="${cx - cw * 0.32}" y1="${y + ch - 3}" x2="${cx + cw * 0.32}" y2="${y + ch - 3}"/>`);
      parts.push(bubble(1, cx + cw / 2 + 14, y + ch / 2), bubble(2, cx - bandW / 2 - 12, y - bh / 2));
      parts.push(dimV(cx - Math.max(bandW, cw) / 2 - 30, y - bh, y + ch, `${f2(g.hc + g.band)} m`));
      y += ch;
      // service module, wings, thrusters, adapter
      const sw = g.s * k, sh = g.hb * k, x0 = cx - sw / 2;
      parts.push(`<rect class="bus" x="${x0}" y="${y}" width="${sw}" height="${sh}" rx="3"/>`);
      const wl = g.L * k, wh = g.Wd * k, yo = g.yoke * k, wy = y + sh / 2 - wh / 2;
      parts.push(`<line class="yoke" x1="${x0}" y1="${y + sh / 2}" x2="${x0 - yo}" y2="${y + sh / 2}"/><line class="yoke" x1="${x0 + sw}" y1="${y + sh / 2}" x2="${x0 + sw + yo}" y2="${y + sh / 2}"/>`);
      for (const sx of [x0 - yo - wl, x0 + sw + yo]) {
        parts.push(`<rect class="wing" x="${sx}" y="${wy}" width="${wl}" height="${wh}"/>`);
        for (let i = 1; i < 4; i++) parts.push(`<line class="cell" x1="${sx + wl * i / 4}" y1="${wy}" x2="${sx + wl * i / 4}" y2="${wy + wh}"/>`);
      }
      parts.push(dimH(x0 - yo - wl, x0 + sw + yo + wl, wy + wh + 14, `${f2(2 * (g.L + g.yoke) + g.s)} m span`));
      parts.push(bubble(3, x0 + 12, y + 12), bubble(4, x0 - yo - wl / 2, wy + wh / 2));
      const icons = [];
      if (d.centrifuge) icons.push(['cf', 7]);
      if (d.furnace) icons.push(['fur', 8]);
      if (d.lit) icons.push(['lit', 9]);
      icons.forEach(([kind, num], i) => {
        const ix = x0 + sw * (0.3 + 0.25 * i), iy = y + sh * 0.6;
        if (kind === 'cf') parts.push(`<circle class="rotor" cx="${ix}" cy="${iy}" r="${Math.min(14, sh * 0.25)}"/><circle class="rotor" cx="${ix}" cy="${iy}" r="3"/>`);
        if (kind === 'fur') parts.push(`<rect class="rad" x="${x0 + sw + 2}" y="${y + 6}" width="6" height="${sh - 12}"/><rect class="hot" x="${ix - 10}" y="${iy - 8}" width="20" height="16" rx="2"/>`);
        if (kind === 'lit') parts.push(`<circle class="led" cx="${ix}" cy="${iy}" r="7"/>`);
        parts.push(bubble(num, ix, iy - Math.min(14, sh * 0.25) - 10));
      });
      if (d.xband) parts.push(`<rect class="xb" x="${x0 + sw - 16}" y="${y + sh - 16}" width="10" height="10"/>`, bubble(6, x0 + sw - 11, y + sh - 26));
      y += sh;
      const nt = d.nThr || 2;
      for (let i = 0; i < nt; i++) { const tx = cx + (i - (nt - 1) / 2) * 22; parts.push(`<path class="thr" d="M${tx - 5} ${y} L${tx + 5} ${y} L${tx + 8} ${y + 12} L${tx - 8} ${y + 12} Z"/>`); }
      parts.push(`<rect class="adapter" x="${cx - 0.19 * k}" y="${y}" width="${0.38 * k}" height="4"/>`, bubble(5, cx + nt * 11 + 14, y + 8));
      call.push(['1', `return capsule ${f0(d.capKg)} kg: ${d.arch === 'C' ? 'live culture system, powered' : `samples ${f1(d.retKg)} kg in a drawer behind a window`}`],
        ['2', `heat shield packed; inflates to Ø ${f2(d.capD)} m before entry`],
        ['3', `service module ${f0(d.busKg)} kg: ${d.arch === 'B' ? 'microscope, pumps, reservoirs stay and burn up' : 'power, radios, attitude, propulsion'}`],
        ['4', `solar wings ${f0(d.arrayW)} W, ${f2(d.arrayM2)} m² of cells`],
        ['5', `${nt} × 22 N green-monopropellant thrusters, launch adapter`]);
      if (d.xband) call.push(['6', 'X-band antenna for video']);
      if (d.centrifuge) call.push(['7', '1 g centrifuge with counter-rotor']);
      if (d.furnace) call.push(['8', 'metallic furnace and radiator']);
      if (d.lit) call.push(['9', 'LED growth light and cameras']);
    }
    // scale bar and title block
    const list = call.map(([n, t], i) => `<g transform="translate(${W - PADR + 14} ${PADT + 8 + i * 30})">${n ? bubble(n, 0, 0) : ''}<foreignObject x="14" y="-11" width="${PADR - 30}" height="30"><div xmlns="http://www.w3.org/1999/xhtml" class="cl">${esc(t)}</div></foreignObject></g>`).join('');
    const archTxt = { A: 'A · in-flight only, no return', B: 'B · samples return, hardware burns up', C: 'C · live return' }[d.arch] || '';
    return `<svg class="satdraw" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.name)} side view">
      <rect class="sheet" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8"/>${parts.join('')}${list}
      <g class="title"><line x1="0" y1="${H - 44}" x2="${W}" y2="${H - 44}"/>
        <text x="16" y="${H - 24}" class="tname">${esc(d.name)}</text><text x="16" y="${H - 10}" class="tsub">${esc(archTxt)}</text>
        <text x="${W - 16}" y="${H - 24}" text-anchor="end" class="tname">${f0(d.wetKg)} kg at launch</text>
        <text x="${W - 16}" y="${H - 10}" text-anchor="end" class="tsub">concept geometry from the sizing model · side view, to scale</text></g>
    </svg>`;
  }
  window.LelpSatDraw = draw;
  // static pages: draw every <div class="satdraw-slot" data-d='{...}'>
  document.querySelectorAll('.satdraw-slot').forEach((el) => { try { el.innerHTML = draw(JSON.parse(el.dataset.d)); } catch (e) { el.textContent = ''; } });
})();
