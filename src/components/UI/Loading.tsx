import { Loader } from "lucide-react";
import { cn } from "../../utils";

interface LoadingProps {
  className?: string;
  size?: number;
}

export const Loading = ({ className, size = 32 }: LoadingProps) => {
  return (
    <div className={cn("flex h-full w-full items-center justify-center", className)}>
      <Loader className="animate-spin text-foreground" size={size} />
    </div>
  );
}; 