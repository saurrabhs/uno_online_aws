'use strict';

// Official Uno color palette — solid, opaque, vibrant
const CARD_COLORS = {
  red:    { bg: '#D32F2F', light: '#EF5350', dark: '#B71C1C', text: '#ffffff' },
  blue:   { bg: '#1565C0', light: '#1E88E5', dark: '#0D47A1', text: '#ffffff' },
  green:  { bg: '#2E7D32', light: '#43A047', dark: '#1B5E20', text: '#ffffff' },
  yellow: { bg: '#F9A825', light: '#FDD835', dark: '#E65100', text: '#ffffff' },
  wild:   { bg: '#212121', light: '#424242', dark: '#000000', text: '#ffffff' }
};

function createCardElement(card, options = {}) {
  const { size = 'normal' } = options;
  const el = document.createElement('div');
  el.className = `card ${size === 'large' ? 'large-card' : ''}`;
  el.dataset.cardId = card.id;
  el.innerHTML = renderCardSVG(card, size);
  return el;
}

function renderCardSVG(card, size = 'normal') {
  const w = size === 'large' ? 90 : 70;
  const h = size === 'large' ? 135 : 105;
  const r = 10;
  const uid = card.id.replace(/[^a-z0-9]/gi, '') + Math.random().toString(36).slice(2, 5);

  const color = card.displayColor || card.color;
  const isWild = card.type === 'wild' || card.type === 'wildDrawFour';
  const scheme = CARD_COLORS[color] || CARD_COLORS.wild;

  const cx = w / 2;
  const cy = h / 2;

  // Diamond dimensions — the white rotated rectangle in the center
  const dw = w * 0.72;
  const dh = h * 0.62;

  let bgFill = isWild ? `url(#wbg${uid})` : scheme.bg;
  let defs = '';

  if (isWild) {
    defs = `
      <defs>
        <linearGradient id="wbg${uid}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#1a1a2e"/>
          <stop offset="100%" stop-color="#16213e"/>
        </linearGradient>
      </defs>`;
  }

  const cardBg = `
    <!-- Card shadow layer -->
    <rect x="0" y="0" width="${w}" height="${h}" rx="${r}" fill="rgba(0,0,0,0.4)" transform="translate(2,3)"/>
    <!-- Solid card body — fully opaque -->
    <rect x="0" y="0" width="${w}" height="${h}" rx="${r}" fill="${bgFill}"/>
    <!-- Top sheen -->
    <rect x="0" y="0" width="${w}" height="${Math.round(h*0.45)}" rx="${r}" fill="rgba(255,255,255,0.08)"/>
    <!-- White border -->
    <rect x="2.5" y="2.5" width="${w-5}" height="${h-5}" rx="${r-1}" fill="none" stroke="white" stroke-width="2.5"/>`;

  let centerContent = '';
  let cornerLabel = '';
  let cornerLabelBot = '';

  switch (card.type) {
    case 'number': {
      cornerLabel = card.value.toString();
      cornerLabelBot = card.value.toString();
      centerContent = renderNumberCard(card.value, cx, cy, dw, dh, w, h, scheme);
      break;
    }
    case 'skip': {
      cornerLabel = '';
      centerContent = renderSkipCard(cx, cy, dw, dh, w, h, scheme);
      // SVG skip icon in corner
      cornerLabel = renderCornerSkipSVG(w, h);
      cornerLabelBot = null; // handled separately
      break;
    }
    case 'reverse': {
      centerContent = renderReverseCard(cx, cy, dw, dh, w, h, scheme);
      cornerLabel = renderCornerReverseSVG(w, h);
      cornerLabelBot = null;
      break;
    }
    case 'drawTwo': {
      cornerLabel = '+2';
      cornerLabelBot = '+2';
      centerContent = renderDrawTwoCard(cx, cy, dw, dh, w, h, scheme);
      break;
    }
    case 'wild': {
      cornerLabel = 'W';
      cornerLabelBot = 'W';
      centerContent = renderWildCard(cx, cy, dw, dh, w, h);
      break;
    }
    case 'wildDrawFour': {
      cornerLabel = '+4';
      cornerLabelBot = '+4';
      centerContent = renderWildDrawFourCard(cx, cy, dw, dh, w, h);
      break;
    }
  }

  const fs = w < 75 ? 9 : 11;
  const co = 5;

  const corners = cornerLabelBot !== null ? `
    <text x="${co}" y="${co + fs + 1}" font-family="'Arial Black',Arial,sans-serif"
          font-size="${fs}" font-weight="900" fill="white"
          style="text-shadow:1px 1px 2px rgba(0,0,0,0.8)">${cornerLabel}</text>
    <text x="${w - co}" y="${h - co}" font-family="'Arial Black',Arial,sans-serif"
          font-size="${fs}" font-weight="900" fill="white" text-anchor="end"
          transform="rotate(180 ${w - co} ${h - co})"
          style="text-shadow:1px 1px 2px rgba(0,0,0,0.8)">${cornerLabelBot}</text>` : cornerLabel;

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"
    style="width:100%;height:100%;display:block;border-radius:${r}px">
    ${defs}
    ${cardBg}
    ${centerContent}
    ${corners}
  </svg>`;
}

// ── Number card ───────────────────────────────────────────────────────────────
function renderNumberCard(value, cx, cy, dw, dh, w, h, scheme) {
  const fs = w < 75 ? 32 : 42;
  return `
    <!-- White diamond -->
    <rect x="${cx - dw/2}" y="${cy - dh/2}" width="${dw}" height="${dh}" rx="6"
          fill="white" transform="rotate(-30 ${cx} ${cy})"/>
    <!-- Number shadow -->
    <text x="${cx+1.5}" y="${cy + fs*0.38 + 1.5}" font-family="'Arial Black',Arial,sans-serif"
          font-size="${fs}" font-weight="900" text-anchor="middle"
          fill="rgba(0,0,0,0.25)">${value}</text>
    <!-- Number -->
    <text x="${cx}" y="${cy + fs*0.38}" font-family="'Arial Black',Arial,sans-serif"
          font-size="${fs}" font-weight="900" text-anchor="middle"
          fill="${scheme.bg}">${value}</text>`;
}

// ── Skip card ─────────────────────────────────────────────────────────────────
function renderSkipCard(cx, cy, dw, dh, w, h, scheme) {
  const r = w * 0.2;
  const sw = w * 0.065;
  return `
    <rect x="${cx - dw/2}" y="${cy - dh/2}" width="${dw}" height="${dh}" rx="6"
          fill="white" transform="rotate(-30 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${scheme.bg}" stroke-width="${sw}"/>
    <line x1="${cx - r*0.7}" y1="${cy - r*0.7}" x2="${cx + r*0.7}" y2="${cy + r*0.7}"
          stroke="${scheme.bg}" stroke-width="${sw}" stroke-linecap="round"/>`;
}

function renderCornerSkipSVG(w, h) {
  const s = w < 75 ? 8 : 10;
  const x = 5, y = 5;
  return `<g>
    <circle cx="${x + s/2}" cy="${y + s/2}" r="${s/2}" fill="none" stroke="white" stroke-width="1.8"/>
    <line x1="${x+2}" y1="${y+2}" x2="${x+s-2}" y2="${y+s-2}" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
  </g>
  <g transform="rotate(180 ${w/2} ${h/2})">
    <circle cx="${x + s/2}" cy="${y + s/2}" r="${s/2}" fill="none" stroke="white" stroke-width="1.8"/>
    <line x1="${x+2}" y1="${y+2}" x2="${x+s-2}" y2="${y+s-2}" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
  </g>`;
}

// ── Reverse card ──────────────────────────────────────────────────────────────
function renderReverseCard(cx, cy, dw, dh, w, h, scheme) {
  const r = w * 0.18;
  const sw = w * 0.055;
  const aw = r * 0.4;
  return `
    <rect x="${cx - dw/2}" y="${cy - dh/2}" width="${dw}" height="${dh}" rx="6"
          fill="white" transform="rotate(-30 ${cx} ${cy})"/>
    <path d="M ${cx-r} ${cy-r*0.25} A ${r} ${r} 0 0 1 ${cx+r} ${cy-r*0.25}"
          fill="none" stroke="${scheme.bg}" stroke-width="${sw}" stroke-linecap="round"/>
    <polygon points="${cx+r},${cy-r*0.25-aw} ${cx+r+aw},${cy-r*0.25} ${cx+r},${cy-r*0.25+aw}"
             fill="${scheme.bg}"/>
    <path d="M ${cx+r} ${cy+r*0.25} A ${r} ${r} 0 0 1 ${cx-r} ${cy+r*0.25}"
          fill="none" stroke="${scheme.bg}" stroke-width="${sw}" stroke-linecap="round"/>
    <polygon points="${cx-r},${cy+r*0.25+aw} ${cx-r-aw},${cy+r*0.25} ${cx-r},${cy+r*0.25-aw}"
             fill="${scheme.bg}"/>`;
}

function renderCornerReverseSVG(w, h) {
  const s = w < 75 ? 9 : 11;
  const x = 5, y = 5;
  const r = s * 0.38;
  const sw = 1.6;
  const aw = r * 0.5;
  return `<g>
    <path d="M ${x} ${y+r*0.5} A ${r} ${r} 0 0 1 ${x+s} ${y+r*0.5}"
          fill="none" stroke="white" stroke-width="${sw}" stroke-linecap="round"/>
    <polygon points="${x+s},${y+r*0.5-aw} ${x+s+aw},${y+r*0.5} ${x+s},${y+r*0.5+aw}" fill="white"/>
    <path d="M ${x+s} ${y+s-r*0.5} A ${r} ${r} 0 0 1 ${x} ${y+s-r*0.5}"
          fill="none" stroke="white" stroke-width="${sw}" stroke-linecap="round"/>
    <polygon points="${x},${y+s-r*0.5+aw} ${x-aw},${y+s-r*0.5} ${x},${y+s-r*0.5-aw}" fill="white"/>
  </g>
  <g transform="rotate(180 ${w/2} ${h/2})">
    <path d="M ${x} ${y+r*0.5} A ${r} ${r} 0 0 1 ${x+s} ${y+r*0.5}"
          fill="none" stroke="white" stroke-width="${sw}" stroke-linecap="round"/>
    <polygon points="${x+s},${y+r*0.5-aw} ${x+s+aw},${y+r*0.5} ${x+s},${y+r*0.5+aw}" fill="white"/>
    <path d="M ${x+s} ${y+s-r*0.5} A ${r} ${r} 0 0 1 ${x} ${y+s-r*0.5}"
          fill="none" stroke="white" stroke-width="${sw}" stroke-linecap="round"/>
    <polygon points="${x},${y+s-r*0.5+aw} ${x-aw},${y+s-r*0.5} ${x},${y+s-r*0.5-aw}" fill="white"/>
  </g>`;
}

// ── Draw Two card ─────────────────────────────────────────────────────────────
function renderDrawTwoCard(cx, cy, dw, dh, w, h, scheme) {
  const cw = w * 0.3, ch = h * 0.38, cr = 4, off = w * 0.09;
  const fs = w * 0.16;
  return `
    <rect x="${cx - dw/2}" y="${cy - dh/2}" width="${dw}" height="${dh}" rx="6"
          fill="white" transform="rotate(-30 ${cx} ${cy})"/>
    <rect x="${cx-cw/2+off}" y="${cy-ch/2-off*0.6}" width="${cw}" height="${ch}" rx="${cr}"
          fill="${scheme.dark}" stroke="white" stroke-width="1.5"/>
    <rect x="${cx-cw/2-off*0.3}" y="${cy-ch/2+off*0.6}" width="${cw}" height="${ch}" rx="${cr}"
          fill="${scheme.bg}" stroke="white" stroke-width="1.5"/>
    <text x="${cx-off*0.3}" y="${cy+off*0.6+fs*0.4}" font-family="'Arial Black',Arial,sans-serif"
          font-size="${fs}" font-weight="900" text-anchor="middle" fill="white">+2</text>`;
}

// ── Wild card ─────────────────────────────────────────────────────────────────
function renderWildCard(cx, cy, dw, dh, w, h) {
  const r = Math.min(dw, dh) * 0.42;
  const colors = ['#D32F2F','#F9A825','#2E7D32','#1565C0'];
  const slices = colors.map((c, i) => {
    const a1 = (i * 90 - 90) * Math.PI / 180;
    const a2 = ((i+1) * 90 - 90) * Math.PI / 180;
    return `<path d="M${cx} ${cy} L${cx+r*Math.cos(a1)} ${cy+r*Math.sin(a1)} A${r} ${r} 0 0 1 ${cx+r*Math.cos(a2)} ${cy+r*Math.sin(a2)}Z" fill="${c}"/>`;
  }).join('');
  const fs = w * 0.12;
  return `
    <rect x="${cx-dw/2}" y="${cy-dh/2}" width="${dw}" height="${dh}" rx="6"
          fill="rgba(255,255,255,0.12)" transform="rotate(-30 ${cx} ${cy})"/>
    ${slices}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="white" stroke-width="2"/>
    <text x="${cx}" y="${cy+fs*0.4}" font-family="'Arial Black',Arial,sans-serif"
          font-size="${fs}" font-weight="900" text-anchor="middle" fill="white"
          stroke="rgba(0,0,0,0.6)" stroke-width="1.5" paint-order="stroke">WILD</text>`;
}

// ── Wild Draw Four card ───────────────────────────────────────────────────────
function renderWildDrawFourCard(cx, cy, dw, dh, w, h) {
  const colors = ['#D32F2F','#F9A825','#2E7D32','#1565C0'];
  const cw = w * 0.24, ch = h * 0.3, cr = 3;
  const offsets = [
    {x: cx - cw*0.5 - w*0.1, y: cy - ch*0.5 - h*0.07},
    {x: cx - cw*0.5 + w*0.1, y: cy - ch*0.5 - h*0.07},
    {x: cx - cw*0.5 - w*0.1, y: cy - ch*0.5 + h*0.1},
    {x: cx - cw*0.5 + w*0.1, y: cy - ch*0.5 + h*0.1}
  ];
  const cards = offsets.map((o, i) =>
    `<rect x="${o.x}" y="${o.y}" width="${cw}" height="${ch}" rx="${cr}"
           fill="${colors[i]}" stroke="white" stroke-width="1.5"/>`
  ).join('');
  const fs = w * 0.16;
  return `
    <rect x="${cx-dw/2}" y="${cy-dh/2}" width="${dw}" height="${dh}" rx="6"
          fill="rgba(255,255,255,0.1)" transform="rotate(-30 ${cx} ${cy})"/>
    ${cards}
    <text x="${cx}" y="${cy + ch*0.5 + h*0.12}" font-family="'Arial Black',Arial,sans-serif"
          font-size="${fs}" font-weight="900" text-anchor="middle" fill="white"
          stroke="rgba(0,0,0,0.6)" stroke-width="1.5" paint-order="stroke">+4</text>`;
}

// ── Card back ─────────────────────────────────────────────────────────────────
function createMiniCardBack() {
  const el = document.createElement('div');
  el.className = 'card card-back';
  el.innerHTML = renderCardBackSVG(28, 42);
  return el;
}

function renderCardBackSVG(w, h) {
  const r = 4;
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"
    style="width:100%;height:100%;display:block;border-radius:${r}px">
    <rect x="0" y="0" width="${w}" height="${h}" rx="${r}" fill="#1a237e"/>
    <rect x="1.5" y="1.5" width="${w-3}" height="${h-3}" rx="${r-1}" fill="none" stroke="white" stroke-width="1.5"/>
    <ellipse cx="${w/2}" cy="${h/2}" rx="${w*0.32}" ry="${h*0.35}"
             fill="none" stroke="#e53935" stroke-width="1.5"/>
    <text x="${w/2}" y="${h/2+3}" font-family="'Arial Black',Arial,sans-serif"
          font-size="${w*0.28}" font-weight="900" text-anchor="middle" fill="white">U</text>
  </svg>`;
}

function getColorHex(colorName) {
  const map = { red:'#D32F2F', blue:'#1565C0', green:'#2E7D32', yellow:'#F9A825', wild:'#212121' };
  return map[colorName] || '#666';
}

window.CardRenderer = { createCardElement, createMiniCardBack, getColorHex, renderCardSVG };
