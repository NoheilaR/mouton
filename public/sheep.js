// Avatars en SVG : moutons de toutes les couleurs (et le Loup), sans aucune image externe.
(() => {
  'use strict';

  const INK = '#463c58';
  // Boucles de laine du corps : [cx, cy, r]
  const WOOL = [[28, 56, 15], [36, 40, 15], [52, 34, 16], [68, 40, 15], [75, 56, 14], [66, 70, 15], [50, 73, 16], [33, 70, 14], [50, 54, 22]];
  // Touffe sur la tête
  const TUFT = [[43, 33, 7], [51, 30, 8], [58, 34, 6.5]];

  // Assombrit une couleur hexadécimale (pour les ombres de la laine)
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = c => Math.max(0, Math.min(255, Math.round(c * k)));
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c => f(c).toString(16).padStart(2, '0')).join('');
  }

  const circles = (list, attrs) => list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" ${attrs}/>`).join('');

  // Yeux et bouche selon l'humeur : happy, sad, ko, sleep, wow, neutral
  function face(mood) {
    let eyes, mouth;
    switch (mood) {
      case 'ko':
        eyes = '<path d="M41 45l6 6M47 45l-6 6M53 45l6 6M59 45l-6 6" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>';
        mouth = '<path d="M46 61 q4 -3 8 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>';
        break;
      case 'sleep':
        eyes = '<path d="M40 49 q4 3 8 0M52 49 q4 3 8 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>';
        mouth = '<circle cx="50" cy="60" r="2" fill="#fff"/>';
        break;
      case 'sad':
        eyes = '<circle cx="44" cy="48" r="4.6" fill="#fff"/><circle cx="56" cy="48" r="4.6" fill="#fff"/><circle cx="44" cy="49.5" r="2.3" fill="' + INK + '"/><circle cx="56" cy="49.5" r="2.3" fill="' + INK + '"/>' +
          '<path d="M38 42 l6 2M62 42 l-6 2" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M39 54 q-2 4 0 6 q2 -2 0 -6Z" fill="#9fd3ff"/>';
        mouth = '<path d="M45 62 q5 -4 10 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>';
        break;
      case 'wow':
        eyes = '<circle cx="44" cy="47" r="5.4" fill="#fff"/><circle cx="56" cy="47" r="5.4" fill="#fff"/><circle cx="44" cy="47" r="2.4" fill="' + INK + '"/><circle cx="56" cy="47" r="2.4" fill="' + INK + '"/>';
        mouth = '<ellipse cx="50" cy="60" rx="3" ry="4" fill="#fff"/>';
        break;
      case 'happy':
        eyes = '<path d="M40 49 q4 -5 8 0M52 49 q4 -5 8 0" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>';
        mouth = '<path d="M44 57 q6 7 12 0Z" fill="#fff"/><path d="M47 60 q3 2.4 6 0" fill="#ff9ec3"/>';
        break;
      default:
        eyes = '<circle cx="44" cy="48" r="4.6" fill="#fff"/><circle cx="56" cy="48" r="4.6" fill="#fff"/><circle cx="45" cy="48.6" r="2.4" fill="' + INK + '"/><circle cx="57" cy="48.6" r="2.4" fill="' + INK + '"/><circle cx="46" cy="47.4" r=".9" fill="#fff"/><circle cx="58" cy="47.4" r=".9" fill="#fff"/>';
        mouth = '<path d="M46 58 q4 3.6 8 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>';
    }
    return eyes + mouth + '<circle cx="39.5" cy="56" r="2.8" fill="#ff9ec3" opacity=".55"/><circle cx="60.5" cy="56" r="2.8" fill="#ff9ec3" opacity=".55"/>';
  }

  // Petite couronne posée sur la touffe
  const CROWN = '<path d="M38 24 l4 -12 l8 8 l8 -8 l4 12Z" fill="#ffd25e" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/><circle cx="42" cy="12" r="2.4" fill="#ff9ec3"/><circle cx="58" cy="12" r="2.4" fill="#ff9ec3"/>';
  // Auréole de fantôme (joueur éliminé)
  const HALO = '<ellipse cx="50" cy="16" rx="13" ry="4" fill="none" stroke="#ffd25e" stroke-width="3"/>';

  // Mouton complet. opts : { mood, crown, halo, title }
  function sheep(color = '#f7f3ea', opts = {}) {
    const dark = shade(color, 0.86);
    const legs = [36, 45, 55, 64].map(x => `<rect x="${x - 3.5}" y="74" width="7" height="16" rx="3.5" fill="${INK}"/>`).join('');
    return `<svg class="sheep-svg" viewBox="0 0 100 100" aria-hidden="true">${opts.title ? `<title>${opts.title}</title>` : ''}
      ${legs}
      <g stroke="${INK}" stroke-width="5">${circles(WOOL, `fill="${color}"`)}</g>
      <g>${circles(WOOL, `fill="${color}"`)}</g>
      ${circles([[30, 63, 7], [70, 63, 7], [50, 76, 8]], `fill="${dark}" opacity=".45"`)}
      <ellipse cx="33" cy="45" rx="8" ry="4.2" fill="${INK}" transform="rotate(-20 33 45)"/>
      <ellipse cx="67" cy="45" rx="8" ry="4.2" fill="${INK}" transform="rotate(20 67 45)"/>
      <ellipse cx="50" cy="51" rx="14" ry="16" fill="${INK}"/>
      <g stroke="${INK}" stroke-width="4">${circles(TUFT, `fill="${color}"`)}</g>
      <g>${circles(TUFT, `fill="${color}"`)}</g>
      ${face(opts.mood)}
      ${opts.crown ? CROWN : ''}${opts.halo ? HALO : ''}
    </svg>`;
  }

  // Le Loup (tête), pour les écrans de démasquage
  function wolf(opts = {}) {
    return `<svg class="wolf-svg" viewBox="0 0 100 100" aria-hidden="true">
      <path d="M22 18 L36 40 L64 40 L78 18 L80 50 Q80 82 50 90 Q20 82 20 50Z" fill="#9aa3c7" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M27 26 L35 40 L30 44Z M73 26 L65 40 L70 44Z" fill="#ffb3c9"/>
      <path d="M34 60 Q50 54 66 60 Q64 84 50 86 Q36 84 34 60Z" fill="#eef0fb"/>
      <path d="M36 48 l10 3M64 48 l-10 3" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>
      <circle cx="41" cy="55" r="4" fill="${opts.glow ? '#ffd25e' : '#fff'}"/><circle cx="59" cy="55" r="4" fill="${opts.glow ? '#ffd25e' : '#fff'}"/>
      <circle cx="41" cy="55.5" r="2" fill="${INK}"/><circle cx="59" cy="55.5" r="2" fill="${INK}"/>
      <ellipse cx="50" cy="66" rx="6" ry="4.4" fill="${INK}"/>
      <path d="M43 75 q7 5 14 0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
      <path d="M45 76 l2 4 l2 -3.4M51 76.6 l2 3.4 l2 -4" fill="#fff" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>`;
  }

  // Cœur (plein, vide ou bouclier)
  const heart = (state = 'full') => `<svg class="heart ${state}" viewBox="0 0 24 22" aria-hidden="true"><path d="M12 21 C5 15.5 1 12 1 7.2 C1 3.8 3.6 1.2 6.8 1.2 C9 1.2 10.8 2.4 12 4.2 C13.2 2.4 15 1.2 17.2 1.2 C20.4 1.2 23 3.8 23 7.2 C23 12 19 15.5 12 21Z"/></svg>`;
  const shield = () => '<svg class="shield" viewBox="0 0 24 26" aria-hidden="true"><path d="M12 1.5 L22 5 V12 C22 18.5 17.5 22.6 12 24.5 C6.5 22.6 2 18.5 2 12 V5Z"/><path d="M8 13 l3 3 l5.4 -6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  window.Sheep = { sheep, wolf, heart, shield, INK };
})();
