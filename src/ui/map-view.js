import { CELL_SIZE, roomAt } from '../level/level.js';

const CELL_PX = 22;
const COLORS = Object.freeze({
  paper: '#d9cfb8',
  wall: '#2a2622',
  floor: '#c7bca3',
  vent: '#8f8a80',
  blocked: '#7a1c14',
  exit: '#2e8a3e',
  exitClosed: '#4a5a4a',
  player: '#b01810',
  label: 'rgba(30, 24, 20, 0.85)',
});
const ROOM_TINT = 0.28; // how much of a room's colour shows on the plan
const ARROW = 9; // px

/**
 * The floor plan the player found: rooms in their colours and names, what is chained or caved in this run, the exit,
 * and a red arrow for where you stand. The plan is drawn once; only the arrow moves.
 * @param {HTMLCanvasElement} canvas
 * @param {import('../level/level.js').Level} level
 * @param {readonly import('../level/level.js').Room[]} rooms
 */
export function createMapView(canvas, level, rooms) {
  canvas.width = level.width * CELL_PX;
  canvas.height = level.height * CELL_PX;
  const ctx = canvas.getContext('2d');
  const plans = [false, true].map((isExitOpen) => {
    const plan = document.createElement('canvas');
    plan.width = canvas.width;
    plan.height = canvas.height;
    drawPlan(plan.getContext('2d'), level, rooms, isExitOpen);
    return plan;
  });

  return {
    /** @param {{ x: number, z: number, yaw: number, isExitOpen: boolean }} view the player, in world space */
    draw({ x, z, yaw, isExitOpen }) {
      ctx.drawImage(plans[isExitOpen ? 1 : 0], 0, 0);
      const px = (x / CELL_SIZE + 0.5) * CELL_PX;
      const pz = (z / CELL_SIZE + 0.5) * CELL_PX;
      ctx.save();
      ctx.translate(px, pz);
      ctx.rotate(-yaw); // forward is (-sin, -cos): up on the plan when yaw is 0
      ctx.fillStyle = COLORS.player;
      ctx.beginPath();
      ctx.moveTo(0, -ARROW);
      ctx.lineTo(ARROW * 0.65, ARROW * 0.7);
      ctx.lineTo(0, ARROW * 0.3);
      ctx.lineTo(-ARROW * 0.65, ARROW * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
}

/** @param {CanvasRenderingContext2D} ctx */
function drawPlan(ctx, level, rooms, isExitOpen) {
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let z = 0; z < level.height; z++) {
    for (let x = 0; x < level.width; x++) {
      ctx.fillStyle = cellColor(level, rooms, x, z, isExitOpen);
      ctx.fillRect(x * CELL_PX, z * CELL_PX, CELL_PX, CELL_PX);
    }
  }
  [...level.lockedDoors, ...level.barricades].forEach(({ x, z }) => drawCross(ctx, x, z));

  ctx.fillStyle = COLORS.label;
  ctx.font = 'bold 12px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  rooms
    .filter((room) => !room.isHall)
    .forEach((room) => {
      ctx.fillText(room.name, ((room.x0 + room.x1 + 1) / 2) * CELL_PX, ((room.z0 + room.z1 + 1) / 2) * CELL_PX);
    });
}

function cellColor(level, rooms, x, z, isExitOpen) {
  const tile = level.tiles[z][x];
  if (tile === 'E') return isExitOpen ? COLORS.exit : COLORS.exitClosed;
  if (tile === 'X' || tile === 'Z') return COLORS.floor;
  if (tile === 'V') return COLORS.vent;
  if (tile === '#') return COLORS.wall;
  const room = roomAt(rooms, { x, z });
  return room ? mix(COLORS.floor, room.color, ROOM_TINT) : COLORS.floor;
}

/** Chained or caved in: a red cross over the cell. */
function drawCross(ctx, x, z) {
  const inset = 4;
  ctx.strokeStyle = COLORS.blocked;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x * CELL_PX + inset, z * CELL_PX + inset);
  ctx.lineTo((x + 1) * CELL_PX - inset, (z + 1) * CELL_PX - inset);
  ctx.moveTo((x + 1) * CELL_PX - inset, z * CELL_PX + inset);
  ctx.lineTo(x * CELL_PX + inset, (z + 1) * CELL_PX - inset);
  ctx.stroke();
}

/** @param {string} base #rrggbb @param {number} tint 0xrrggbb @param {number} amount 0..1 */
function mix(base, tint, amount) {
  const from = parseInt(base.slice(1), 16);
  const channel = (shift) => {
    const a = (from >> shift) & 0xff;
    const b = (tint >> shift) & 0xff;
    return Math.round(a + (b - a) * amount);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
