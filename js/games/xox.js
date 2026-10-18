// Tic-Tac-Toe (server/rooms.js markCell): a 6 by 6 board, four in a row takes the round, first to 3.
// X is red and O is blue, as in the app.
const X = '<svg viewBox="0 0 40 40"><path d="M9 9l22 22M31 9L9 31"/></svg>';
const O = '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="12"/></svg>';

export default {
  status({ room, me, name }) {
    const xox = room.xox;
    if (!xox) return '';
    if (room.phase === 'roundOver') return xox.winner ? (xox.winner === me ? 'You took the round' : `${name(xox.winner)} took the round`) : 'A draw';
    return xox.turn === me ? 'Your turn' : `Turn: ${name(xox.turn)}`;
  },
  mark(room, id) {
    if (!room.xox) return null;
    return id === room.xox.x ? { svg: X, color: 'var(--red)' } : { svg: O, color: 'var(--blue)' };
  },
  render(el, { room, me, send, before }) {
    const xox = room.xox;
    if (!xox) return;
    const mine = room.phase === 'racing' && !room.paused && xox.turn === me;
    const fresh = new Set(xox.cells.map((cell, i) => (cell && !before?.xox?.cells?.[i] ? i : -1)).filter((i) => i >= 0));
    const won = new Set(xox.line ?? []);
    el.innerHTML = `<div class="xox ${mine ? 'mine' : ''}" style="--n:${xox.size}">${xox.cells.map((cell, i) => `
      <button class="cell ${cell ?? ''} ${fresh.has(i) ? 'fresh' : ''} ${won.has(i) ? 'won' : ''}" data-cell="${i}" ${cell || !mine ? 'disabled' : ''} aria-label="Cell ${i + 1}">${cell === 'x' ? X : cell === 'o' ? O : ''}</button>`).join('')}
    </div>`;
    el.querySelector('.xox').addEventListener('click', (event) => {
      const cell = event.target.closest('[data-cell]');
      if (!cell || cell.disabled) return;
      send('mark', { cell: Number(cell.dataset.cell) });
    });
  },
};
