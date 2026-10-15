import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

const svgProps = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * Loop de carregamento SVG (layout-dashboard → layers → layout-grid → blocks).
 * Cada vértice do loop morfa para o próximo enquanto o arquivo é processado.
 */
export function LoadingIcons({ size = 48, className }: { size?: number; className?: string }) {
  const style = (i: number) => ({ "--i": i }) as CSSProperties;
  return (
    <div
      className={cn("icon-loop-morph", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span style={style(0)}>
        <svg {...svgProps}>
          <rect pathLength="1" width="7" height="9" x="3" y="3" rx="1" />
          <rect pathLength="1" width="7" height="5" x="14" y="3" rx="1" />
          <rect pathLength="1" width="7" height="9" x="14" y="12" rx="1" />
          <rect pathLength="1" width="7" height="5" x="3" y="16" rx="1" />
        </svg>
      </span>
      <span style={style(1)}>
        <svg {...svgProps}>
          <path
            pathLength="1"
            d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"
          />
          <path pathLength="1" d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
          <path pathLength="1" d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
        </svg>
      </span>
      <span style={style(2)}>
        <svg {...svgProps}>
          <rect pathLength="1" width="7" height="7" x="3" y="3" rx="1" />
          <rect pathLength="1" width="7" height="7" x="14" y="3" rx="1" />
          <rect pathLength="1" width="7" height="7" x="14" y="14" rx="1" />
          <rect pathLength="1" width="7" height="7" x="3" y="14" rx="1" />
        </svg>
      </span>
      <span style={style(3)}>
        <svg {...svgProps}>
          <rect pathLength="1" width="7" height="7" x="14" y="3" rx="1" />
          <path
            pathLength="1"
            d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"
          />
        </svg>
      </span>
      <style>{`
.icon-loop-morph{position:relative;display:inline-block;width:48px;height:48px;color:currentColor}
.icon-loop-morph span{position:absolute;inset:0;display:grid;place-items:center;opacity:0;animation:iconLoop-morph 8s cubic-bezier(.65,0,.35,1) infinite;animation-delay:calc(var(--i)*-2s)}
.icon-loop-morph svg{width:100%;height:100%;overflow:visible}
@keyframes iconLoop-morph{
  0%{opacity:0;transform:scale(.55) rotate(-14deg)}
  4%,21%{opacity:1;transform:scale(1) rotate(0deg)}
  25%,100%{opacity:0;transform:scale(1.25) rotate(10deg)}
}
.icon-loop-morph span > svg > *{transform-origin:center;transform-box:fill-box;stroke-dasharray:1}
.icon-loop-morph span:nth-child(1) > svg > *{animation:iconSig-morph-0 8s cubic-bezier(.34,1.56,.64,1) infinite;animation-delay:calc(0s + var(--n) * 0.075s)}
.icon-loop-morph span:nth-child(1) > svg > *:nth-child(1){--n:0}
.icon-loop-morph span:nth-child(1) > svg > *:nth-child(2){--n:1}
.icon-loop-morph span:nth-child(1) > svg > *:nth-child(3){--n:3}
.icon-loop-morph span:nth-child(1) > svg > *:nth-child(4){--n:2}
.icon-loop-morph span:nth-child(2) > svg > *{animation:iconSig-morph-1 8s cubic-bezier(.34,1.56,.64,1) infinite;animation-delay:calc(-2s + var(--n) * 0.09s)}
.icon-loop-morph span:nth-child(2) > svg > *:nth-child(1){--n:2}
.icon-loop-morph span:nth-child(2) > svg > *:nth-child(2){--n:1}
.icon-loop-morph span:nth-child(2) > svg > *:nth-child(3){--n:0}
.icon-loop-morph span:nth-child(3) > svg > *{animation:iconSig-morph-2 8s cubic-bezier(.34,1.56,.64,1) infinite;animation-delay:calc(-4s + var(--n) * 0.07s)}
.icon-loop-morph span:nth-child(3) > svg > *:nth-child(1){--n:0}
.icon-loop-morph span:nth-child(3) > svg > *:nth-child(2){--n:1}
.icon-loop-morph span:nth-child(3) > svg > *:nth-child(3){--n:3}
.icon-loop-morph span:nth-child(3) > svg > *:nth-child(4){--n:2}
.icon-loop-morph span:nth-child(4) > svg > *{animation:iconSig-morph-3 8s ease-in-out infinite;animation-delay:calc(-6s + var(--n) * 0.14s)}
.icon-loop-morph span:nth-child(4) > svg > *:nth-child(1){--n:1}
.icon-loop-morph span:nth-child(4) > svg > *:nth-child(2){--n:0}
@keyframes iconSig-morph-0{
  0%{opacity:0;transform:scale(.2)}
  7%{opacity:1;transform:scale(1.12)}
  10%,20%{opacity:1;transform:scale(1)}
  25%,100%{opacity:0;transform:scale(.2)}
}
@keyframes iconSig-morph-1{
  0%{opacity:0;transform:translateY(7px)}
  8%{opacity:1;transform:translateY(-1.5px)}
  12%,20%{opacity:1;transform:translateY(0)}
  25%,100%{opacity:0;transform:translateY(7px)}
}
@keyframes iconSig-morph-2{
  0%{opacity:0;transform:scale(.3) rotate(-90deg)}
  9%,20%{opacity:1;transform:scale(1) rotate(0deg)}
  25%,100%{opacity:0;transform:scale(.3) rotate(90deg)}
}
@keyframes iconSig-morph-3{
  0%{opacity:0;stroke-dashoffset:1;transform:scale(.7)}
  4%{opacity:1}
  12%,20%{opacity:1;stroke-dashoffset:0;transform:scale(1)}
  25%,100%{opacity:0;stroke-dashoffset:1;transform:scale(.7)}
}
`}</style>
    </div>
  );
}
