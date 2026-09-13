import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../../../../UI/DropdownMenu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../../UI/Tooltip";
import { AVAILABLE_NETWORKS, IS_V3_PROFILE } from "@/config";
import { useStore } from "../../../../../stores/store";
import { cva } from "class-variance-authority";
import { Check, ChevronDown, Globe, Network, Workflow } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useState } from "react";

// Helper to convert hex to rgba
function hexToRgba(hexColor: string, alpha: number): string {
  const hex = hexColor.replace("#", "");
  if (hex.length === 3) {
    const r = parseInt(hex.charAt(0) + hex.charAt(0), 16);
    const g = parseInt(hex.charAt(1) + hex.charAt(1), 16);
    const b = parseInt(hex.charAt(2) + hex.charAt(2), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hexColor;
}

const blockchainSelectionClasses = cva("cursor-pointer", {
  variants: {
    isSelected: {
      true: ["text-success focus:text-success"],
    },
  },
  defaultVariants: {
    isSelected: false,
  },
});

// Animated pulsing dot component
const PulsingDot = ({ isConnected }: { isConnected: boolean }) => {
  const color = isConnected ? "#37bd8a" : "#ef4444"; // success green / red-500

  return (
    <>
      <style>{`
        @keyframes slow-ping {
          75%, 100% {
            transform: scale(2);
            opacity: 0;
          }
        }
        .animate-slow-ping {
          animation: slow-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
      `}</style>
      <div
        className="relative flex h-2 w-2 items-center justify-center rounded-full"
        style={{ backgroundColor: hexToRgba(color, 0.4) }}
      >
        <div
          className={`absolute flex h-3 w-3 items-center justify-center rounded-full ${
            isConnected ? "animate-slow-ping" : "animate-ping"
          }`}
          style={{ backgroundColor: color, opacity: 0.75 }}
        />
        <div
          className="absolute flex h-2 w-2 items-center justify-center rounded-full"
          style={{ backgroundColor: hexToRgba(color, 0.9) }}
        />
      </div>
    </>
  );
};

const ConnectionBadge = observer(() => {
  const { qrlStore } = useStore();
  const { qrlConnection, selectBlockchain } = qrlStore;
  const { isConnected, qrlNetworkName, isLoading } = qrlConnection;
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  return (
    <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen} modal={false}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="group flex items-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/[0.04] px-2.5 py-1.5 text-muted-foreground backdrop-blur-sm transition-all duration-200 hover:border-foreground/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={`Network: ${qrlNetworkName}`}
              >
                <PulsingDot isConnected={isConnected} />
                {IS_V3_PROFILE ? (
                  <span className="text-xs font-medium">v3 Private</span>
                ) : (
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <ChevronDown
                  className={`h-3 w-3 text-muted-foreground transition-transform duration-200 ${
                    isDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{qrlNetworkName}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuLabel>Blockchain network</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {AVAILABLE_NETWORKS.map((network) => (
            <DropdownMenuItem
              key={network.id}
              className={blockchainSelectionClasses({
                isSelected: network.name === qrlNetworkName,
              })}
              onClick={() => selectBlockchain(network.id)}
              disabled={isLoading}
            >
              {network.id === "MAIN_NET" ? (
                <Network className="mr-2 h-4 w-4" />
              ) : (
                <Workflow className="mr-2 h-4 w-4" />
              )}
              <span>{network.name}</span>
              {network.name === qrlNetworkName && (
                <DropdownMenuShortcut>
                  <Check className="h-4 w-4" />
                </DropdownMenuShortcut>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export default ConnectionBadge;
