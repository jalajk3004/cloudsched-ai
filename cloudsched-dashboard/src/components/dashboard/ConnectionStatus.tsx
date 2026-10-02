import { ConnectionStatus as ConnectionStatusType } from "@/lib/scheduler/types";
import { Radio, Wifi, WifiOff, Loader2 } from "lucide-react";

const CONFIG: Record<ConnectionStatusType, { label: string; className: string; icon: typeof Radio }> = {
    demo: { label: "DEMO DATA", className: "text-amber-400 bg-amber-950/50", icon: Radio },
    live: { label: "LIVE", className: "text-emerald-400 bg-emerald-950/50", icon: Wifi },
    connecting: { label: "CONNECTING", className: "text-neutral-400 bg-neutral-800", icon: Loader2 },
    disconnected: { label: "DISCONNECTED", className: "text-red-400 bg-red-950/50", icon: WifiOff },
};

export function ConnectionStatus({ status }: { status: ConnectionStatusType }) {
    const { label, className, icon: Icon } = CONFIG[status];
    return (
        <span className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${className}`}>
            <Icon className={`h-3.5 w-3.5 ${status === "connecting" ? "animate-spin" : ""}`} />
            {label}
        </span>
    );
}