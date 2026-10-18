// Four in a Row (server/rooms.js dropDisc): seven columns, six rows, four of yours in a line takes the
// round, first to 3. Red for the room's first seat, yellow for the second, as in the app.
const colorOf = (room, id) => (room.players[0]?.id === id ? 'red' : 'yellow');

export default {
  status({ room, me, name }) {
    const drop = room.drop;
    if (!drop) return '';
    if (room.phase === 'roundOver') return drop.winner ? (drop.winner === me ? 'You took the round' : `${name(drop.winner)} took the round`) : 'A draw';
    return drop.turn === me ? 'Your turn' : `Turn: ${name(drop.turn)}`;
  },
  mark(room, id) {
    return { svg: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="14"/></svg>', color: colorOf(room, id) === 'red' ? 'var(--disc-red)' : 'var(--yellow)', fill: true };
  },
  render(el, { room, me, send }) {
    const drop = room.drop;
    if (!drop) return;
    const mine = room.phase === 'racing' && !room.paused && drop.turn === me;
    const won = new Set(drop.line ?? []);
    const columns = Array.from({ length: drop.columns }, (_, column) => {
      const full = Boolean(drop.cells[column]);
      const cells = Array.from({ length: drop.rows }, (_, row) => {
        const index = row * drop.columns + column;
        const owner = drop.cells[index];
        const disc = owner ? `<i class="disc ${colorOf(room, owner)} ${index === drop.last ? 'last' : ''} ${won.has(index) ? 'won' : ''}" style="--row:${row + 1}"></i>` : '';
        return `<span class="hole">${disc}</span>`;
      }).join('');
      return `<button class="column" data-column="${column}" ${!mine || full ? 'disabled' : ''} aria-label="Column ${column + 1}"><span class="ghost ${colorOf(room, me)}"></span>${cells}</button>`;
    }).join('');
    el.innerHTML = `<div class="four ${mine ? 'mine' : ''}" style="--columns:${drop.columns}">${columns}</div>`;
    el.querySelector('.four').addEventListener('click', (event) => {
      const column = event.target.closest('[data-column]');
      if (!column || column.disabled) return;
      send('drop', { column: Number(column.dataset.column) });
    });
  },
};
