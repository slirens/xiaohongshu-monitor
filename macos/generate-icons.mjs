import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [source, output] = process.argv.slice(2);
const names = ['alert', 'back', 'calendar', 'check', 'chevron', 'doc', 'export', 'folder',
  'spinner', 'stop', 'tray', 'updown', 'xmark'];
const cases = names.map(name => {
  const svg = readFileSync(join(source, name + '.svg'), 'utf8');
  const bounds = svg.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number);
  const path = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*stroke-width:\s*1\.6[^>]*>/g)][0]?.[1];
  if (!bounds || bounds[2] !== 24 || bounds[3] !== 24 || !path) throw new Error('Invalid FA icon: ' + name);
  const point = (numbers, index) => 'pt(' +
    (+(numbers[index] - bounds[0]).toFixed(4)) + ', ' + (+(numbers[index + 1] - bounds[1]).toFixed(4)) + ')';
  const commands = [...path.matchAll(/([A-Za-z])([^A-Za-z]*)/g)].map(([, type, coordinates]) => {
    const numbers = coordinates.match(/-?(?:\d+(?:\.\d+)?|\.\d+)/g)?.map(Number) ?? [];
    switch (type) {
      case 'M':
        if (numbers.length === 2) return 'path.move(to: ' + point(numbers, 0) + ')';
        break;
      case 'L':
        if (numbers.length === 2) return 'path.addLine(to: ' + point(numbers, 0) + ')';
        break;
      case 'C':
        if (numbers.length === 6) return 'path.addCurve(to: ' + point(numbers, 4) +
          ', control1: ' + point(numbers, 0) + ', control2: ' + point(numbers, 2) + ')';
        break;
      case 'Z':
      case 'z':
        if (!numbers.length) return 'path.closeSubpath()';
        break;
    }
    throw new Error('Unsupported command in FA icon ' + name + ': ' + type + coordinates);
  });
  return '        case .' + (name === 'export' ? 'exportFile' : name) +
    ':\n            ' + commands.join('\n            ');
});
const swift = [
  '// Generated from the F+1A Penpot icon SVGs at build time.',
  'import SwiftUI',
  '',
  'enum FAIcon: String, Shape {',
  '    case ' + names.map(name => name === 'export' ? 'exportFile' : name).join(', '),
  '',
  '    func path(in rect: CGRect) -> Path {',
  '        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {',
  '            CGPoint(x: rect.minX + x * rect.width / 24, y: rect.minY + y * rect.height / 24)',
  '        }',
  '        var path = Path()',
  '        switch self {',
  ...cases,
  '        }',
  '        return path',
  '    }',
  '}',
  '',
].join('\n');
writeFileSync(output, swift);
