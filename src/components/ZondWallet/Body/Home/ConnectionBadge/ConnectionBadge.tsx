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
import { ZOND_PROVIDER } from "@/config";
import { useStore } from "../../../../../stores/store";
import { cva } from "class-variance-authority";
import { Check, ChevronRight, Network, Workflow, ExternalLink } from "lucide-react";
import { observer } from "mobx-react-lite";
import { CustomRpcModal } from "./CustomRpcModal";
import { useState } from "react";

// Helper to convert hex to rgba
function hexToRgba(hexColor: string, alpha: number): string {
  const hex = hexColor.replace("#", "");
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
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
      true: ["text-green-500 focus:text-green-500"],
    },
  },
  defaultVariants: {
    isSelected: false,
  },
});

// Animated pulsing dot component
const PulsingDot = ({ isConnected }: { isConnected: boolean }) => {
  const color = isConnected ? "#22c55e" : "#ef4444"; // green-500 / red-500

  return (
    <div
      className="relative flex h-2 w-2 items-center justify-center rounded-full"
      style={{ backgroundColor: hexToRgba(color, 0.4) }}
    >
      <div
        className="absolute flex h-3 w-3 animate-ping items-center justify-center rounded-full"
        style={{ backgroundColor: color, opacity: 0.75 }}
      />
      <div
        className="absolute flex h-2 w-2 items-center justify-center rounded-full"
        style={{ backgroundColor: hexToRgba(color, 0.9) }}
      />
    </div>
  );
};

const ConnectionBadge = observer(() => {
  const { zondStore } = useStore();
  const { zondConnection, selectBlockchain } = zondStore;
  const { isConnected, zondNetworkName, isLoading } = zondConnection;
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isCustomRpcModalOpen, setIsCustomRpcModalOpen] = useState(false);
  const { TEST_NET, MAIN_NET, CUSTOM_RPC } = ZOND_PROVIDER;
  const [isTestNetwork, isMainNetwork, isCustomRpcNetwork] = [
    TEST_NET.name === zondNetworkName,
    MAIN_NET.name === zondNetworkName,
    CUSTOM_RPC.name === zondNetworkName,
  ];

  return (
    <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className="group relative flex items-center justify-center gap-3 rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-neutral-700 transition-all duration-200 hover:border-neutral-400 dark:border-neutral-700/80 dark:bg-black dark:text-zinc-300 dark:hover:border-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-accent focus-visible:ring-offset-2"
        >
          <PulsingDot isConnected={isConnected} />
          <div className="mx-1 h-4 w-px bg-neutral-300 dark:bg-neutral-600/80" />
          <span className="text-sm font-medium">{zondNetworkName}</span>
          <ChevronRight
            className={`ml-1 h-3.5 w-3.5 text-neutral-400 transition-transform duration-200 dark:text-neutral-500 ${
              isDropdownOpen ? "rotate-90" : "group-hover:translate-x-0.5"
            }`}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Blockchain network</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className={blockchainSelectionClasses({
              isSelected: isTestNetwork,
            })}
            onClick={() => selectBlockchain(TEST_NET.id)}
            disabled={isLoading}
          >
            <Workflow className="mr-2 h-4 w-4" />
            <span>{TEST_NET.name}</span>
            {isTestNetwork && (
              <DropdownMenuShortcut>
                <Check className="h-4 w-4" />
              </DropdownMenuShortcut>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            className={blockchainSelectionClasses({
              isSelected: isMainNetwork,
            })}
            onClick={() => selectBlockchain(MAIN_NET.id)}
            disabled={isLoading}
          >
            <Network className="mr-2 h-4 w-4" />
            <span>{MAIN_NET.name}</span>
            {isMainNetwork && (
              <DropdownMenuShortcut>
                <Check className="h-4 w-4" />
              </DropdownMenuShortcut>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            className={blockchainSelectionClasses({
              isSelected: isCustomRpcNetwork,
            })}
            onClick={() => { setIsCustomRpcModalOpen(true); setIsDropdownOpen(false) }}
            disabled={isLoading}
          >
            <Network className="mr-2 h-4 w-4" />
            <span>Custom RPC</span>
            <DropdownMenuShortcut>
              <ExternalLink className="h-4 w-4" />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
      <CustomRpcModal isOpen={isCustomRpcModalOpen} onClose={() => setIsCustomRpcModalOpen(false)} />
    </DropdownMenu>
  );
});

export default ConnectionBadge;
