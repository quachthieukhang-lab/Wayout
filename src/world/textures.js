import * as THREE from 'three';
import seedrandom from 'seedrandom';

const TEXTURE_SIZE = 256;

/** Seeded PRNG so the level looks the same on every run. @param {number} seed @returns {() => number} 0..1 */
export function createRng(seed) {
  return seedrandom(String(seed));
}

function canvasTexture(draw, { width = TEXTURE_SIZE, height = width, isRepeating = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (isRepeating) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function addGrime(ctx, width, height, rng, count, color) {
  for (let i = 0; i < count; i++) {
    const x = rng() * width;
    const y = rng() * height;
    const r = 4 + rng() * 30;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Sickly hospital paint over a dark lower panel, with grime and water drips. */
export function createWallTexture(rng) {
  return canvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#7b8072';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#4c5446';
    ctx.fillRect(0, h * 0.62, w, h * 0.38);
    ctx.fillStyle = '#2c302a';
    ctx.fillRect(0, h * 0.6, w, 4);
    addGrime(ctx, w, h, rng, 60, 'rgba(30,25,15,0.35)');
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = 'rgba(40,35,20,0.25)';
      ctx.fillRect(rng() * w, 0, 1 + rng() * 2, 20 + rng() * h * 0.6);
    }
  });
}

/** Dirty checkered tiles. */
export function createFloorTexture(rng) {
  return canvasTexture((ctx, w, h) => {
    const tiles = 4;
    const size = w / tiles;
    for (let y = 0; y < tiles; y++) {
      for (let x = 0; x < tiles; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#3b3a35' : '#2b2a27';
        ctx.fillRect(x * size, y * size, size, size);
      }
    }
    ctx.strokeStyle = '#1a1917';
    ctx.lineWidth = 2;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath();
      ctx.moveTo(i * size, 0);
      ctx.lineTo(i * size, h);
      ctx.moveTo(0, i * size);
      ctx.lineTo(w, i * size);
      ctx.stroke();
    }
    addGrime(ctx, w, h, rng, 50, 'rgba(10,8,5,0.45)');
  });
}

/** Stained ceiling panels. */
export function createCeilingTexture(rng) {
  return canvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#4f514c';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2a2b28';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w / 2, h / 2);
    ctx.strokeRect(w / 2, h / 2, w / 2, h / 2);
    addGrime(ctx, w, h, rng, 25, 'rgba(70,50,20,0.4)');
  });
}

/** Transparent blood splatter for floor decals. */
export function createBloodTexture(rng) {
  return canvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = 'rgba(70,0,0,0.85)';
      for (let i = 0; i < 18; i++) {
        const angle = rng() * Math.PI * 2;
        const distance = rng() * w * 0.3;
        ctx.beginPath();
        ctx.arc(w / 2 + Math.cos(angle) * distance, h / 2 + Math.sin(angle) * distance, 4 + rng() * 26, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { isRepeating: false },
  );
}

/** Scrawled red message for wall decals. @param {string} text */
export function createMessageTexture(text, rng) {
  return canvasTexture(
    (ctx, w, h) => {
      ctx.translate(w / 2, h / 2);
      ctx.rotate((rng() - 0.5) * 0.15);
      ctx.font = 'bold 64px "Oswald", "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(110,0,0,0.9)';
      ctx.fillText(text, 0, 0);
      const width = ctx.measureText(text).width;
      for (let i = 0; i < 10; i++) {
        ctx.fillRect(-width / 2 + rng() * width, 18, 3, 10 + rng() * 50); // drips
      }
    },
    { width: 512, height: 256, isRepeating: false },
  );
}

/** Green emergency exit sign. */
export function createExitSignTexture() {
  return canvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = '#0b5d1e';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e8ffe8';
      ctx.font = 'bold 52px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('EXIT', w / 2, h / 2);
    },
    { width: 320, height: 96, isRepeating: false },
  );
}

/** Locker door: scratched green metal with see-through slits at eye height (transparent pixels). */
export function createLockerDoorTexture(rng) {
  return canvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = '#56665f';
      ctx.fillRect(0, 0, w, h);
      addGrime(ctx, w, h, rng, 30, 'rgba(40,25,15,0.45)');
      ctx.strokeStyle = 'rgba(210,220,210,0.18)';
      for (let i = 0; i < 25; i++) {
        ctx.beginPath();
        const x = rng() * w;
        const y = rng() * h;
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rng() - 0.5) * 30, y + (rng() - 0.5) * 30);
        ctx.stroke();
      }
      // Five slits from 1.40 m to 1.87 m on the 2.06 m door: the eye inside is at 1.68 m.
      for (let i = 0; i < 5; i++) ctx.clearRect(w * 0.16, h * (0.1 + i * 0.05), w * 0.68, h * 0.028);
      ctx.fillStyle = '#9a9a92';
      ctx.fillRect(w * 0.78, h * 0.48, w * 0.08, h * 0.08); // handle
    },
    { width: 128, height: 256, isRepeating: false },
  );
}

/** Light, worn paint for a room's colour band; the room colour tints it (multiplied in). A dark trim runs along its top. */
export function createPaintTexture(rng) {
  return canvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#d6d6d6';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, 0, w, 6);
    addGrime(ctx, w, h, rng, 45, 'rgba(40,30,20,0.4)');
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = 'rgba(25,20,15,0.3)'; // scuffs and chipped paint
      ctx.fillRect(rng() * w, 8 + rng() * h, 4 + rng() * 40, 1 + rng() * 2);
    }
  });
}

/** Hospital name plate: dark plate, a stripe of the room colour, white letters. @param {string} name @param {number} color */
export function createRoomSignTexture(name, color) {
  return canvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = '#16181a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.fillRect(0, 0, 28, h);
      ctx.fillStyle = '#e6e2d8';
      ctx.font = 'bold 60px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, (w + 28) / 2, h / 2);
    },
    { width: 512, height: 128, isRepeating: false },
  );
}

/** Scattered glass shards on a transparent background, for a floor decal. */
export function createGlassTexture(rng) {
  return canvasTexture(
    (ctx, w, h) => {
      for (let i = 0; i < 70; i++) {
        const x = rng() * w;
        const y = rng() * h;
        const size = 3 + rng() * 10;
        ctx.fillStyle = `rgba(${200 + rng() * 55}, ${220 + rng() * 35}, 255, ${0.35 + rng() * 0.45})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rng() - 0.5) * size * 2, y + rng() * size);
        ctx.lineTo(x + (rng() - 0.5) * size, y - rng() * size);
        ctx.closePath();
        ctx.fill();
      }
    },
    { isRepeating: false },
  );
}

/** Worn, gappy floorboards, for a floor decal. */
export function createBoardsTexture(rng) {
  return canvasTexture(
    (ctx, w, h) => {
      const boards = 6;
      for (let i = 0; i < boards; i++) {
        const shade = 70 + rng() * 30;
        ctx.fillStyle = `rgb(${shade + 20}, ${shade}, ${shade - 25})`;
        ctx.fillRect(0, (i * h) / boards + 2, w, h / boards - 4);
        ctx.strokeStyle = 'rgba(30, 20, 10, 0.35)';
        for (let j = 0; j < 5; j++) {
          const y = (i * h) / boards + 6 + rng() * (h / boards - 12);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y + (rng() - 0.5) * 6);
          ctx.stroke();
        }
      }
      addGrime(ctx, w, h, rng, 20, 'rgba(20,12,6,0.4)');
    },
    { isRepeating: false },
  );
}
