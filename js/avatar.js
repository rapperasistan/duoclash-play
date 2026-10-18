// The app's twelve drawn faces (Multimobile/UI/Avatar.swift), as SVG, and a person's picture when they have one.
import { faceLink } from './api.js';

const COLORS = ['#FFC83D', '#FF8A3D', '#3CCB9A', '#45A8F5', '#9BD53F', '#F2594B', '#22B8B0', '#E9B872', '#2F6BFF', '#8FA34B', '#C77D3A', '#5C6B7A'];
export const AVATARS = COLORS.length;
const INK = '#16171B';

const point = (cx, cy, r, degrees) => {
  const a = (degrees * Math.PI) / 180;
  return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
};
const arc = (cx, cy, r, from, to) => `M${point(cx, cy, r, from)} A${r} ${r} 0 0 1 ${point(cx, cy, r, to)}`;

export function avatarSVG(index) {
  const n = ((Number(index) % AVATARS) + AVATARS) % AVATARS;
  const eyes = n % 3;
  const mouth = Math.floor(n / 3) % 4;
  const line = `fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"`;
  let parts = `<circle cx="50" cy="50" r="50" fill="${COLORS[n]}"/>`;
  if (mouth < 2) for (const side of [-1, 1]) parts += `<ellipse cx="${50 + side * 27}" cy="60.5" rx="7.5" ry="4.5" fill="#fff" fill-opacity=".28"/>`;
  for (const side of [-1, 1]) {
    const x = 50 + side * 17;
    if (eyes === 0 || (eyes === 2 && side < 0)) parts += `<ellipse cx="${x}" cy="42" rx="6" ry="7.2" fill="${INK}"/>`;
    else if (eyes === 1) parts += `<path d="${arc(x, 46.2, 7.44, 200, 340)}" ${line}/>`;
    else parts += `<path d="M${x - 6.6} 42H${x + 6.6}" ${line}/>`;
  }
  if (mouth === 0) parts += `<path d="${arc(50, 56, 14, 25, 155)}" ${line}/>`;
  else if (mouth === 1) parts += `<path d="${arc(50, 60, 13, 0, 180)}Z" fill="${INK}"/>`;
  else if (mouth === 2) parts += `<ellipse cx="50" cy="66.5" rx="5.5" ry="6.5" fill="${INK}"/>`;
  else parts += `<path d="${arc(54, 52, 13, 45, 120)}" ${line}/>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${parts}</svg>`;
}

/** A person's face: their picture, or their drawn face. */
export function face(person, size = 40) {
  const inner = person?.face
    ? `<img src="${faceLink(person.face)}" alt="" loading="lazy">`
    : avatarSVG(person?.avatar ?? 0);
  return `<span class="face" style="--size:${size}px">${inner}</span>`;
}
