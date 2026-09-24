import type { SVGProps } from "react";

// The MyQRLWallet brand mark: 13 rounded blocks tracing an omega, the QRL
// symbol. Source of truth lives in the design handoff (mark.svg, 24x24
// viewBox); kept here as data so the mark renders inline and follows
// `currentColor` instead of shipping a raster image.
const BLOCKS: ReadonlyArray<readonly [number, number]> = [
  [5.1, 0.4],
  [9.8, 0.4],
  [14.5, 0.4],
  [0.4, 5.1],
  [19.2, 5.1],
  [0.4, 9.8],
  [19.2, 9.8],
  [5.1, 14.5],
  [14.5, 14.5],
  [0.4, 19.2],
  [5.1, 19.2],
  [14.5, 19.2],
  [19.2, 19.2],
];

export function QrlMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {BLOCKS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={4.4} height={4.4} rx={0.5} />
      ))}
    </svg>
  );
}

export default QrlMark;
