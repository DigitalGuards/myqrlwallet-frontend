import * as React from "react";
import { cn } from "../../utils";

interface ShinyButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  className?: string;
  /** When true, slows down the animation to indicate processing */
  processing?: boolean;
}

/**
 * An animated button with a shiny shimmer effect.
 * When `processing` is true, the animation slows down to indicate work in progress.
 */
export const ShinyButton = React.forwardRef<HTMLButtonElement, ShinyButtonProps>(
  ({ children, className = "", processing = false, disabled, ...props }, ref) => {
    return (
      <>
        <style>{`
          @property --gradient-angle {
            syntax: "<angle>";
            initial-value: 0deg;
            inherits: false;
          }

          @property --gradient-angle-offset {
            syntax: "<angle>";
            initial-value: 0deg;
            inherits: false;
          }

          @property --gradient-percent {
            syntax: "<percentage>";
            initial-value: 5%;
            inherits: false;
          }

          @property --gradient-shine {
            syntax: "<color>";
            initial-value: white;
            inherits: false;
          }

          .shiny-btn {
            --shiny-cta-highlight: #4aafff;
            --shiny-cta-highlight-subtle: #3a9fee;
            --animation: gradient-angle linear infinite;
            --shadow-size: 2px;
          }

          /* Normal speed */
          .shiny-btn:not(.shiny-btn--processing) {
            --duration: 3s;
            --transition: 800ms cubic-bezier(0.25, 1, 0.5, 1);
          }

          /* Slow speed when processing */
          .shiny-btn--processing {
            --duration: 8s;
            --transition: 1500ms cubic-bezier(0.25, 1, 0.5, 1);
          }

          .shiny-btn {
            isolation: isolate;
            position: relative;
            overflow: hidden;
            cursor: pointer;
            outline-offset: 4px;
            border: 1px solid transparent;
            background:
              linear-gradient(hsl(var(--card)), hsl(var(--card))) padding-box,
              conic-gradient(
                  from calc(var(--gradient-angle) - var(--gradient-angle-offset)),
                  transparent,
                  var(--shiny-cta-highlight) var(--gradient-percent),
                  var(--gradient-shine) calc(var(--gradient-percent) * 2),
                  var(--shiny-cta-highlight) calc(var(--gradient-percent) * 3),
                  transparent calc(var(--gradient-percent) * 4)
                )
                border-box;
            box-shadow: inset 0 0 0 1px hsl(var(--border));
            transition: var(--transition);
            transition-property:
              --gradient-angle-offset, --gradient-percent, --gradient-shine;
          }

          .shiny-btn:disabled {
            cursor: not-allowed;
            opacity: 0.5;
          }

          .shiny-btn::before,
          .shiny-btn::after,
          .shiny-btn .shiny-btn__content::before {
            content: "";
            pointer-events: none;
            position: absolute;
            inset-inline-start: 50%;
            inset-block-start: 50%;
            translate: -50% -50%;
            z-index: -1;
          }

          .shiny-btn:active:not(:disabled) {
            translate: 0 1px;
          }

          /* Dots pattern */
          .shiny-btn::before {
            --size: calc(100% - var(--shadow-size) * 3);
            --position: 2px;
            --space: calc(var(--position) * 2);
            width: var(--size);
            height: var(--size);
            background: radial-gradient(
                circle at var(--position) var(--position),
                currentColor calc(var(--position) / 4),
                transparent 0
              )
              padding-box;
            background-size: var(--space) var(--space);
            background-repeat: space;
            mask-image: conic-gradient(
              from calc(var(--gradient-angle) + 45deg),
              black,
              transparent 10% 90%,
              black
            );
            border-radius: 0.5rem;
            opacity: 0.4;
            z-index: -1;
          }

          /* Inner shimmer */
          .shiny-btn::after {
            --animation: shimmer linear infinite;
            width: 100%;
            aspect-ratio: 1;
            background: linear-gradient(
              -50deg,
              transparent,
              var(--shiny-cta-highlight),
              transparent
            );
            mask-image: radial-gradient(circle at bottom, transparent 40%, black);
            opacity: 0.6;
          }

          .shiny-btn .shiny-btn__content {
            z-index: 1;
          }

          .shiny-btn .shiny-btn__content::before {
            --size: calc(100% + 1rem);
            width: var(--size);
            height: var(--size);
            box-shadow: inset 0 -1ex 2rem 4px var(--shiny-cta-highlight);
            opacity: 0;
            transition: opacity var(--transition);
            animation: calc(var(--duration) * 1.5) breathe linear infinite;
          }

          /* Animate */
          .shiny-btn,
          .shiny-btn::before,
          .shiny-btn::after {
            animation:
              var(--animation) var(--duration),
              var(--animation) calc(var(--duration) / 0.4) reverse paused;
            animation-composition: add;
          }

          .shiny-btn:is(:hover, :focus-visible):not(:disabled) {
            --gradient-percent: 20%;
            --gradient-angle-offset: 95deg;
            --gradient-shine: var(--shiny-cta-highlight-subtle);
          }

          .shiny-btn:is(:hover, :focus-visible):not(:disabled),
          .shiny-btn:is(:hover, :focus-visible):not(:disabled)::before,
          .shiny-btn:is(:hover, :focus-visible):not(:disabled)::after {
            animation-play-state: running;
          }

          /* Always animate when processing */
          .shiny-btn--processing,
          .shiny-btn--processing::before,
          .shiny-btn--processing::after {
            animation-play-state: running !important;
          }

          .shiny-btn:is(:hover, :focus-visible):not(:disabled) .shiny-btn__content::before {
            opacity: 1;
          }

          @keyframes gradient-angle {
            to {
              --gradient-angle: 360deg;
            }
          }

          @keyframes shimmer {
            to {
              rotate: 360deg;
            }
          }

          @keyframes breathe {
            from,
            to {
              scale: 1;
            }
            50% {
              scale: 1.2;
            }
          }
        `}</style>

        <button
          ref={ref}
          className={cn(
            "shiny-btn inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-4 py-2",
            "text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            processing && "shiny-btn--processing",
            className
          )}
          disabled={disabled || processing}
          {...props}
        >
          <span className="shiny-btn__content flex items-center justify-center">
            {children}
          </span>
        </button>
      </>
    );
  }
);

ShinyButton.displayName = "ShinyButton";
