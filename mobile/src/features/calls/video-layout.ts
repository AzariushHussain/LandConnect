export function videoGrid(count: number, width: number, height: number) {
  if (!count || width <= 0 || height <= 0) return [];
  const columns = count === 1 ? 1 : 2,
    rows = Math.ceil(count / columns);
  const gap = Math.min(6, width / 10, height / 10);
  const tileWidth = (width - gap * (columns - 1)) / columns;
  const tileHeight = (height - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, index) => ({
    left: (index % columns) * (tileWidth + gap),
    top: Math.floor(index / columns) * (tileHeight + gap),
    width: count === 3 && index === 2 ? width : tileWidth,
    height: tileHeight,
  }));
}
