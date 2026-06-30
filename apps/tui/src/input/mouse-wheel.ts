export function isMouseInput(input: string): boolean {
  return (
    /\u001B?\[<\d+;\d+;\d+[mM]/.test(input) ||
    /^\u001B?\[<\d+;\d+;\d+[mM]$/.test(input) ||
    /^\u001B?\[M/.test(input)
  );
}

export function wheelScrollDelta(input: string): number {
  let delta = 0;
  for (const match of input.matchAll(/\u001B?\[<(\d+);(\d+);(\d+)([mM])/g)) {
    const code = Number(match[1]);
    if (!Number.isFinite(code)) continue;
    if ((code & 64) !== 64) continue;

    if ((code & 1) === 0) {
      delta += 3;
    } else {
      delta -= 3;
    }
  }
  return delta;
}
