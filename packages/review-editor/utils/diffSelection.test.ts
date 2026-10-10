import { describe, expect, test } from 'bun:test';
import { getLineNumberFromNode, getSideFromNode } from './diffSelection';

const hasDom = typeof document !== 'undefined';

// Pierre 1.3.2 puts both sides into one data-unified code column, with
// change-deletion/change-addition on the rows. Context rows in split mode
// instead inherit their side from the enclosing code column.
function rowNode(column: string, lineType: string, line: number): Text {
  const code = document.createElement('code');
  code.setAttribute(column, '');
  const row = document.createElement('div');
  row.dataset.line = String(line);
  row.dataset.lineType = lineType;
  const token = document.createElement('span');
  const text = document.createTextNode('selected code');
  token.appendChild(text);
  row.appendChild(token);
  code.appendChild(row);
  return text;
}

describe.if(hasDom)('diff text-selection anchors', () => {
  test('unified deleted code keeps old-side coordinates, including reversed multi-line drags', () => {
    const first = rowNode('data-unified', 'change-deletion', 40);
    const last = rowNode('data-unified', 'change-deletion', 43);
    for (const [anchor, focus] of [[first, last], [last, first]]) {
      const start = getLineNumberFromNode(anchor)!;
      const end = getLineNumberFromNode(focus)!;
      expect({
        start: Math.min(start, end),
        end: Math.max(start, end),
        side: getSideFromNode(anchor),
      }).toEqual({ start: 40, end: 43, side: 'deletions' });
    }
  });

  test('unified added lines use new-side coordinates rather than old row indices', () => {
    const node = rowNode('data-unified', 'change-addition', 7);
    expect(getSideFromNode(node)).toBe('additions');
    expect(getLineNumberFromNode(node)).toBe(7);
  });

  test('split context lines still inherit the correct column side', () => {
    expect(getSideFromNode(rowNode('data-deletions', 'context', 40))).toBe('deletions');
    expect(getSideFromNode(rowNode('data-additions', 'context', 7))).toBe('additions');
    expect(getSideFromNode(rowNode('data-unified', 'context', 7))).toBe('additions');
  });
});
