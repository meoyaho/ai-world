// MediaPipe가 준 손 관절 좌표로 손짓을 판별한다. 브라우저 API를 쓰지 않아 Node에서도 시험할 수 있다.
// 관절 번호: 0 손목 / 엄지 1~4 / 검지 5~8 / 중지 9~12 / 약지 13~16 / 새끼 17~20 (각 손가락 MCP, PIP, DIP, 끝)

export const GESTURES = {
  thumb_up: { tone: 'up', symbol: '👍', label: '엄지척' },
  heart: { tone: 'up', symbol: '🫶', label: '하트' },
  pray: { tone: 'up', symbol: '🙏', label: '두 손 모아 빌기' },
  thumb_down: { tone: 'down', symbol: '👎', label: '엄지 아래' },
  middle_finger: { tone: 'down', symbol: '🖕', label: '가운데 손가락' },
  punch: { tone: 'down', symbol: '👊', label: '주먹 치기' },
};

const MIN_SCORE = 0.65;
const FINGERS = { index: [5, 6, 8], middle: [9, 10, 12], ring: [13, 14, 16], pinky: [17, 18, 20] };

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// 가로세로 비율을 맞춰 거리를 잰다. (정규화 좌표는 가로와 세로의 단위가 다르다)
function toPoints(landmarks, aspect) {
  return landmarks.map(([x, y]) => [x * aspect, y]);
}

// 손목에서 손끝까지가 손목에서 PIP 관절까지보다 충분히 멀면 펴진 것, 가까우면 접힌 것
function fingerRatio(points, finger) {
  const [, pip, tip] = FINGERS[finger];
  return distance(points[0], points[tip]) / Math.max(1e-6, distance(points[0], points[pip]));
}
const extended = (points, finger) => fingerRatio(points, finger) > 1.15;
const folded = (points, finger) => fingerRatio(points, finger) < 1.0;

function palmSize(points) {
  return Math.max(1e-6, distance(points[0], points[9]));
}

function boxSize(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function center(points) {
  return [
    points.reduce((sum, p) => sum + p[0], 0) / points.length,
    points.reduce((sum, p) => sum + p[1], 0) / points.length,
  ];
}

export function isMiddleFinger(points) {
  return extended(points, 'middle') && fingerRatio(points, 'middle') > 1.25 &&
    folded(points, 'index') && folded(points, 'ring') && folded(points, 'pinky');
}

// 손가락 하트: 엄지 끝이 검지 끝(또는 끝 마디)에 닿고, 나머지 세 손가락은 접혀 있으며,
// 엄지·검지 끝이 손바닥보다 위에 있다. (주먹을 쥐었을 때 엄지가 검지에 닿는 경우를 거른다)
export function isFingerHeart(points, category) {
  if (category === 'Closed_Fist') return false;
  const palm = palmSize(points);
  const touching = Math.min(distance(points[4], points[8]), distance(points[4], points[7])) < palm * 0.4;
  const raised = points[4][1] < points[5][1] && points[8][1] < points[5][1];
  return touching && raised && folded(points, 'middle') && folded(points, 'ring') && folded(points, 'pinky');
}

// 두 손 하트: 양손 검지 끝끼리, 엄지 끝끼리 맞닿고 검지가 엄지보다 위에 있다.
export function isTwoHandHeart(a, b) {
  const palm = (palmSize(a) + palmSize(b)) / 2;
  const indexTouch = distance(a[8], b[8]) < palm * 0.6;
  const thumbTouch = distance(a[4], b[4]) < palm * 0.6;
  const indexAbove = (a[8][1] + b[8][1]) / 2 < (a[4][1] + b[4][1]) / 2 - palm * 0.4;
  return indexTouch && thumbTouch && indexAbove;
}

// 두 손 모아 빌기: 두 손목과 두 가운데 손끝이 모여 있고, 손가락이 펴져 위를 향한다.
export function isPray(a, b) {
  const palm = (palmSize(a) + palmSize(b)) / 2;
  const wristsClose = distance(a[0], b[0]) < palm * 1.0;
  const tipsClose = distance(a[12], b[12]) < palm * 0.6;
  const upright = a[12][1] < a[0][1] - palm && b[12][1] < b[0][1] - palm;
  return wristsClose && tipsClose && upright && extended(a, 'middle') && extended(b, 'middle');
}

export function isFist(points, category, score) {
  if (category === 'Closed_Fist' && score >= 0.5) return true;
  return ['index', 'middle', 'ring', 'pinky'].every((finger) => folded(points, finger));
}

// 한 프레임의 정지 손짓을 고른다. 두 손 동작 > 가운데 손가락 > 하트 > 엄지 순으로 본다.
// hands: [{ landmarks: [[x, y], ...], category, score }]
export function classifyPose(hands, aspect = 4 / 3) {
  const prepared = hands.map((hand) => ({ ...hand, points: toPoints(hand.landmarks, aspect) }));
  if (prepared.length >= 2) {
    const [a, b] = prepared;
    if (isPray(a.points, b.points)) return 'pray';
    if (isTwoHandHeart(a.points, b.points)) return 'heart';
  }
  for (const hand of prepared) if (isMiddleFinger(hand.points)) return 'middle_finger';
  for (const hand of prepared) if (isFingerHeart(hand.points, hand.category)) return 'heart';
  for (const hand of prepared) {
    if (hand.score < MIN_SCORE) continue;
    if (hand.category === 'Thumb_Up') return 'thumb_up';
    if (hand.category === 'Thumb_Down') return 'thumb_down';
  }
  return null;
}

// 주먹 치기는 움직임이라 여러 프레임을 본다. 주먹이 짧은 시간에 크게 다가오거나(화면에서 커짐)
// 빠르게 휘둘러지면 한 번 알린다.
export class PunchDetector {
  constructor({ windowMs = 450, growth = 1.3, swing = 1.2, cooldownMs = 1200 } = {}) {
    Object.assign(this, { windowMs, growth, swing, cooldownMs });
    this.history = [];
    this.lastPunch = -Infinity;
  }

  update(hands, now, aspect = 4 / 3) {
    const fists = hands
      .map((hand) => ({ ...hand, points: toPoints(hand.landmarks, aspect) }))
      .filter((hand) => isFist(hand.points, hand.category, hand.score));
    if (!fists.length) {
      this.history = [];
      return false;
    }
    const fist = fists.reduce((big, hand) => (boxSize(hand.points) > boxSize(big.points) ? hand : big));
    const sample = { time: now, size: boxSize(fist.points), center: center(fist.points) };
    this.history = this.history.filter((old) => now - old.time <= this.windowMs);
    this.history.push(sample);
    if (now - this.lastPunch < this.cooldownMs || this.history.length < 2) return false;

    const smallest = Math.min(...this.history.map((old) => old.size));
    const moved = Math.max(...this.history.map((old) => distance(old.center, sample.center)));
    if (sample.size / smallest >= this.growth || moved >= sample.size * this.swing) {
      this.lastPunch = now;
      this.history = [];
      return true;
    }
    return false;
  }
}
