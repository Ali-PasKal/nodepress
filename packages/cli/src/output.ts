const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;

const wrap = (code: number) => (text: string) =>
  useColor ? `\u001b[${String(code)}m${text}\u001b[0m` : text;

export const color = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  cyan: wrap(36),
};

export function heading(text: string): void {
  console.log(`\n${color.bold(color.cyan('▸'))} ${color.bold(text)}`);
}

export function fail(message: string): never {
  console.error(`${color.red('✗')} ${message}`);
  process.exit(1);
}
