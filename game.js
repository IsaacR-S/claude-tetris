'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggleBtn = document.getElementById('theme-toggle');
const startOverlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');
const startRecordsEl = document.getElementById('start-records');
const overlayRecordsEl = document.getElementById('overlay-records');
const recordMsg = document.getElementById('overlay-record-msg');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name-input');

const HIGHSCORES_KEY = 'tetris-highscores';
const MAX_RECORDS = 5;
const MAX_NAME_LEN = 12;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo = 0, maxCombo = 0, started = false;
let records = { entries: [], bestCombo: 0, bestLines: 0 };
let pendingRecord = false;

// ---- Records (localStorage) ----
function toCount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function sanitizeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  return {
    name: String(e.name ?? '').trim().slice(0, MAX_NAME_LEN) || 'Anónimo',
    score: toCount(e.score),
    lines: toCount(e.lines),
    maxCombo: toCount(e.maxCombo),
    date: typeof e.date === 'string' ? e.date.slice(0, 40) : '',
  };
}

function loadRecords() {
  const result = { entries: [], bestCombo: 0, bestLines: 0 };
  try {
    const raw = localStorage.getItem(HIGHSCORES_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.entries) ? data.entries : []);
      result.entries = list.map(sanitizeEntry).filter(Boolean)
        .sort((a, b) => b.score - a.score).slice(0, MAX_RECORDS);
      result.bestCombo = toCount(data && data.bestCombo);
      result.bestLines = toCount(data && data.bestLines);
      for (const e of result.entries) {
        result.bestCombo = Math.max(result.bestCombo, e.maxCombo);
        result.bestLines = Math.max(result.bestLines, e.lines);
      }
    }
  } catch (err) { /* datos corruptos o localStorage no disponible */ }
  return result;
}

function saveRecords() {
  try {
    localStorage.setItem(HIGHSCORES_KEY, JSON.stringify(records));
  } catch (err) { /* ignorar */ }
}

function qualifiesForTop(s) {
  if (s <= 0) return false;
  return records.entries.length < MAX_RECORDS || s > records.entries[records.entries.length - 1].score;
}

function addRecord(name) {
  const entry = {
    name: String(name).trim().slice(0, MAX_NAME_LEN) || 'Anónimo',
    score, lines, maxCombo,
    date: new Date().toISOString(),
  };
  let idx = records.entries.findIndex(e => e.score < entry.score);
  if (idx === -1) idx = records.entries.length;
  records.entries.splice(idx, 0, entry);
  records.entries = records.entries.slice(0, MAX_RECORDS);
  saveRecords();
  return entry;
}

function makeEl(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

function renderRecords(container, highlight) {
  container.replaceChildren();
  container.appendChild(makeEl('h2', 'MEJORES PUNTUACIONES'));
  if (!records.entries.length) {
    container.appendChild(makeEl('p', 'Aún no hay records', 'empty'));
  } else {
    const table = document.createElement('table');
    const head = document.createElement('tr');
    ['#', 'Nombre', 'Puntos', 'Líneas', 'Combo', 'Fecha'].forEach(t => head.appendChild(makeEl('th', t)));
    table.appendChild(head);
    records.entries.forEach((e, i) => {
      const tr = document.createElement('tr');
      if (e === highlight) tr.className = 'highlight';
      const d = new Date(e.date);
      const dateText = isNaN(d) ? '-' : d.toLocaleDateString('es-ES');
      [i + 1, e.name, e.score.toLocaleString(), e.lines, e.maxCombo, dateText]
        .forEach(v => tr.appendChild(makeEl('td', String(v))));
      table.appendChild(tr);
    });
    container.appendChild(table);
  }
  container.appendChild(makeEl('p',
    `Mejor combo: ${records.bestCombo} · Líneas máximas: ${records.bestLines}`, 'bests'));
  const resetBtn = makeEl('button', 'Resetear records', 'reset-records-btn');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    if (!window.confirm('¿Borrar todos los records?')) return;
    records = { entries: [], bestCombo: 0, bestLines: 0 };
    saveRecords();
    if (pendingRecord) {
      pendingRecord = false;
      nameForm.classList.add('hidden');
      recordMsg.classList.add('hidden');
    }
    renderRecords(container, null);
  });
  container.appendChild(resetBtn);
}

function finishNameEntry() {
  if (!pendingRecord) return null;
  pendingRecord = false;
  nameForm.classList.add('hidden');
  return addRecord(nameInput.value);
}

records = loadRecords();

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c] && current.y + r >= 0)
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  if (clearLines() > 0) {
    combo++;
    if (combo > maxCombo) maxCombo = combo;
  } else {
    combo = 0;
  }
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function getThemeVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = getThemeVar('--block-highlight', 'rgba(255,255,255,0.12)');
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = getThemeVar('--grid-line', '#22222e');
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  records.bestCombo = Math.max(records.bestCombo, maxCombo);
  records.bestLines = Math.max(records.bestLines, lines);
  saveRecords();
  pendingRecord = qualifiesForTop(score);
  nameForm.classList.toggle('hidden', !pendingRecord);
  recordMsg.classList.toggle('hidden', !pendingRecord);
  recordMsg.textContent = pendingRecord ? '¡Entras en el top 5! Escribe tu nombre' : '';
  nameInput.value = '';
  renderRecords(overlayRecordsEl, null);
  overlayRecordsEl.classList.remove('hidden');
  overlay.classList.remove('hidden');
  if (pendingRecord) nameInput.focus();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    recordMsg.classList.add('hidden');
    nameForm.classList.add('hidden');
    overlayRecordsEl.classList.add('hidden');
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  combo = 0;
  maxCombo = 0;
  pendingRecord = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (!started) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', () => {
  finishNameEntry();
  init();
});

nameForm.addEventListener('submit', e => {
  e.preventDefault();
  const entry = finishNameEntry();
  recordMsg.textContent = 'Record guardado';
  recordMsg.classList.remove('hidden');
  renderRecords(overlayRecordsEl, entry);
  restartBtn.focus();
});

startBtn.addEventListener('click', () => {
  started = true;
  startOverlay.classList.add('hidden');
  startBtn.blur();
  init();
});

function themeIcon(theme) {
  return theme === 'light' ? '🌙' : '☀️';
}

function setTheme(theme) {
  document.documentElement.classList.toggle('light-theme', theme === 'light');
  localStorage.setItem('theme', theme);
  themeToggleBtn.textContent = themeIcon(theme);
  if (board && current) {
    draw();
    drawNext();
  }
}

themeToggleBtn.textContent = themeIcon(
  document.documentElement.classList.contains('light-theme') ? 'light' : 'dark'
);

themeToggleBtn.addEventListener('click', () => {
  const isLight = document.documentElement.classList.contains('light-theme');
  setTheme(isLight ? 'dark' : 'light');
});

board = createBoard();
renderRecords(startRecordsEl, null);
