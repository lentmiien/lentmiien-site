'use strict';

// Uses only ordinary public model inputs and readable attack telegraphs. No
// position, health, inventory, cooldown, or enemy state is altered by this pilot.
function nextAction(game, C) {
  const p = game.player;
  if (p.hp <= 3 && game.inventory.medicine) return { action: 'medicine' };
  const threats = game.map.enemies.filter(e => e.hp > 0 && e.windup > 0 && e.windup < .45 && e.intent.some(c => c.x === p.x && c.y === p.y));
  if (threats.length && game.shield <= .1 && game.guardTime <= .1) {
    if (!game.cooldowns.guard) return { action: 'guard' };
    if (game.focus >= C.ARTS.find(a => a.id === game.art).cost && !game.cooldowns.art) return { action: 'art' };
    if (game.inventory.bomb) return { action: 'bomb' };
    const dodge = C.DIRS.findIndex(([dx, dy]) => C.walkable(game.map, p.x + dx, p.y + dy, game.phase) && !game.enemyAt(p.x + dx, p.y + dy) && !threats.some(e => e.intent.some(c => c.x === p.x + dx && c.y === p.y + dy)));
    if (dodge >= 0) return { action: 'move', direction: dodge };
    if (!game.shiftCooldown && C.walkable(game.map, p.x, p.y, 1 - game.phase)) return { action: 'shift' };
  }
  const near = game.map.enemies.some(e => e.hp > 0 && Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) <= game.stats().reach && C.lineOfSight(game.map, p, e, game.phase));
  if (near) return { action: game.cooldowns.attack ? 'wait' : 'attack' };
  const path = game.guide();
  if (path.length <= 1 && game.seeds === 3) return { action: 'interact' };
  const cell = path[1];
  if (!cell) throw new Error('Required objective has no route');
  if (cell.phase !== game.phase) return { action: game.shiftCooldown ? 'wait' : 'shift' };
  return { action: 'move', direction: C.DIRS.findIndex(([dx, dy]) => p.x + dx === cell.x && p.y + dy === cell.y) };
}

function advance(game, seconds) {
  const count = Math.ceil(seconds / .05);
  for (let i = 0; i < count; i += 1) game.update(seconds / count);
}

function finishExpedition(game, C) {
  for (let actions = 0; actions < 12000; actions += 1) {
    if (['won', 'lost', 'returned'].includes(game.status)) return game.status;
    if (game.status === 'blessing') {
      const choices = game.choices();
      game.chooseBlessing((choices.find(b => b.id === 'radiance') || choices.find(b => b.id === 'harvest') || choices.find(b => b.id === 'quick') || choices[0]).id);
      continue;
    }
    advance(game, .16);
    const input = nextAction(game, C);
    game.act(input.action, input.direction);
  }
  throw new Error('Expedition exceeded bounded playthrough length');
}

module.exports = { nextAction, advance, finishExpedition };
