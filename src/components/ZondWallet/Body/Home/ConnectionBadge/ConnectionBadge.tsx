import { Button } from "../../../../UI/Button";
import { Card } from "../../../../UI/Card";
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
import { Check, ChevronDown, Network, Workflow, ExternalLink } from "lucide-react";
import { observer } from "mobx-react-lite";
import { CustomRpcModal } from "./CustomRpcModal";
import { useState } from "react";

const networkStatusClasses = cva("h-2 w-2 rounded-full", {
  variants: {
    networkStatus: {
      true: ["bg-green-500"],
      false: ["bg-destructive"],
    },
  },
  defaultVariants: {
    networkStatus: false,
  },
});

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
    <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="flex gap-2 rounded-full">
          <Card
            className={networkStatusClasses({
              networkStatus: isConnected,
            })}
          />
          {zondNetworkName}
          <ChevronDown className="h-4 w-4" />
        </Button>
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
