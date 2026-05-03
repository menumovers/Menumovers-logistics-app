import { ChevronDown, ChevronRight, Layers, Bike, Store, Home, Check, Clock } from "lucide-react";
import { useState } from "react";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-stone-200 text-stone-700",
    driver_assigned: "bg-blue-100 text-blue-800",
    en_route_to_restaurant: "bg-blue-100 text-blue-800",
    picked_up: "bg-violet-100 text-violet-800",
    en_route_to_customer: "bg-violet-100 text-violet-800",
    delivered: "bg-emerald-100 text-emerald-800",
    postponed: "bg-amber-100 text-amber-800",
  };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${map[status] ?? "bg-stone-200"}`}>{status.replace(/_/g, " ")}</span>;
}

function TripRow({
  id, label, ridername, total, done, expanded, onToggle, children,
}: { id: string; label: string; ridername: string; total: number; done: number; expanded: boolean; onToggle: () => void; children?: React.ReactNode }) {
  const pct = Math.round((done / total) * 100);
  return (
    <div className="rounded-lg border border-[#0e2746]/30 bg-[#0e2746]/[0.03] shadow-sm">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        {expanded ? <ChevronDown className="h-4 w-4 text-stone-500" /> : <ChevronRight className="h-4 w-4 text-stone-500" />}
        <Layers className="h-4 w-4 text-[#0e2746]" />
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-bold">Trip #{id}</span>
            <span className="text-stone-500">·</span>
            <span>{label}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-stone-500">
            <Bike className="h-3 w-3" /> {ridername}
            <span>·</span>
            <span>{done}/{total} stops</span>
          </div>
        </div>
        <div className="flex w-32 items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full bg-[#0e2746]" style={{ width: `${pct}%` }} />
          </div>
          <span className="w-9 text-right text-xs tabular-nums text-stone-600">{pct}%</span>
        </div>
      </button>
      {expanded && <div className="border-t border-[#0e2746]/10 bg-white px-3 py-2">{children}</div>}
    </div>
  );
}

function StopLine({ kind, done, isNext, label, sublabel, time }: { kind: "pickup" | "dropoff"; done: boolean; isNext?: boolean; label: string; sublabel: string; time: string }) {
  return (
    <div className={`flex items-center gap-2 rounded px-2 py-1.5 ${isNext ? "bg-amber-50 ring-1 ring-amber-200" : ""} ${done ? "opacity-60" : ""}`}>
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${done ? "bg-emerald-100 text-emerald-700" : kind === "pickup" ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
        {done ? <Check className="h-3 w-3" strokeWidth={3} /> : kind === "pickup" ? <Store className="h-3 w-3" /> : <Home className="h-3 w-3" />}
      </span>
      <span className={`flex-1 truncate text-xs ${done ? "line-through" : ""}`}>
        <span className="font-medium">{label}</span>
        <span className="ml-1 text-stone-500">{sublabel}</span>
      </span>
      {isNext && <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-900">next</span>}
      <span className="w-12 text-right text-[11px] tabular-nums text-stone-500">{time}</span>
    </div>
  );
}

function SoloOrderRow({ id, customer, restaurant, status, pickup }: { id: string; customer: string; restaurant: string; status: string; pickup: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2.5 shadow-sm">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100">
        <Store className="h-4 w-4 text-stone-500" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-bold">#{id}</span>
          <span className="text-stone-500">·</span>
          <span>{customer}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-stone-500">
          <span>{restaurant}</span>
          <span>·</span>
          <Clock className="h-3 w-3" /><span>{pickup}</span>
        </div>
      </div>
      <StatusBadge status={status} />
    </div>
  );
}

export function CoordinatorDispatchWithTrips() {
  const [exp, setExp] = useState({ "42": true, "41": false });

  return (
    <div className="min-h-screen bg-[#f6f3ec] p-6 font-sans text-[#0e2746]">
      <div className="mx-auto max-w-[1040px]">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-stone-500">Coordinator</div>
            <h1 className="mt-0.5 text-2xl font-bold">Dispatch</h1>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700">Filters</button>
            <button className="rounded-md bg-[#0e2746] px-4 py-2 text-sm font-semibold text-white">+ New trip</button>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2 text-xs text-stone-500">
          <span className="rounded-full bg-white px-2.5 py-1 font-medium text-[#0e2746] ring-1 ring-stone-200">Active · 7</span>
          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-stone-200">Pending · 3</span>
          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-stone-200">Delivered today · 24</span>
        </div>

        <div className="space-y-2">
          {/* Expanded trip — partly complete, shows the user's example sequence */}
          <TripRow
            id="42"
            label="4 orders · Centrum"
            ridername="Pieter"
            total={8}
            done={5}
            expanded={exp["42"]}
            onToggle={() => setExp((s) => ({ ...s, "42": !s["42"] }))}
          >
            <div className="space-y-1">
              <StopLine kind="pickup"  done       label="Pickup at Pizza Roma"   sublabel="#1001 De Vries · bundled with #1002" time="18:00" />
              <StopLine kind="pickup"  done       label="Pickup at Pizza Roma"   sublabel="#1002 Jansen"                       time="18:00" />
              <StopLine kind="pickup"  done       label="Pickup at Sushi Haru"   sublabel="#1003 Bakker"                       time="18:10" />
              <StopLine kind="dropoff" done       label="Drop-off Jansen"         sublabel="Marnixkade 8"                       time="18:18" />
              <StopLine kind="dropoff" done       label="Drop-off Bakker"         sublabel="Reguliersgr. 44"                    time="18:24" />
              <StopLine kind="pickup"  done={false} isNext label="Pickup at Wok Express" sublabel="#1004 Smit"                  time="18:30" />
              <StopLine kind="dropoff" done={false} label="Drop-off Smit"           sublabel="Prinsengr. 290"                    time="≈ 18:38" />
              <StopLine kind="dropoff" done={false} label="Drop-off De Vries"       sublabel="Westerstr. 12"                     time="≈ 18:45" />
            </div>
          </TripRow>

          {/* Collapsed trip */}
          <TripRow
            id="41"
            label="3 orders · Oost"
            ridername="Anna"
            total={6}
            done={6}
            expanded={exp["41"]}
            onToggle={() => setExp((s) => ({ ...s, "41": !s["41"] }))}
          />

          {/* Solo orders */}
          <SoloOrderRow id="1010" customer="Bos — Zuid"        restaurant="Sushi Haru" status="driver_assigned" pickup="18:35" />
          <SoloOrderRow id="1011" customer="Hendriks — Centrum" restaurant="Pizza Roma" status="pending"         pickup="18:40" />
          <SoloOrderRow id="1012" customer="Mulder — West"      restaurant="Wok Express" status="postponed"      pickup="18:45" />
        </div>
      </div>
    </div>
  );
}
