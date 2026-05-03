import { Check, ChevronRight, Clock, Home, MoreVertical, Store, MapPin, Phone, AlertTriangle } from "lucide-react";

type Stop = {
  kind: "pickup" | "dropoff";
  orderId: string;
  who: string;
  where: string;
  time: string;
  done?: boolean;
  isNext?: boolean;
};

const stops: Stop[] = [
  { kind: "pickup",  orderId: "1001", who: "Pizza Roma",   where: "bundled with #1002", time: "18:00", done: true },
  { kind: "pickup",  orderId: "1002", who: "Pizza Roma",   where: "Jansen",              time: "18:00", done: true },
  { kind: "pickup",  orderId: "1003", who: "Sushi Haru",   where: "Bakker",              time: "18:10", isNext: true },
  { kind: "dropoff", orderId: "1002", who: "Jansen",       where: "Marnixkade 8",        time: "≈ 18:20" },
  { kind: "dropoff", orderId: "1003", who: "Bakker",       where: "Reguliersgr. 44",     time: "≈ 18:25" },
  { kind: "pickup",  orderId: "1004", who: "Wok Express",  where: "Smit",                time: "18:30" },
  { kind: "dropoff", orderId: "1004", who: "Smit",         where: "Prinsengr. 290",      time: "≈ 18:38" },
  { kind: "dropoff", orderId: "1001", who: "De Vries",     where: "Westerstr. 12",       time: "≈ 18:45" },
];

function MiniStop({ s, idx }: { s: Stop; idx: number }) {
  const icon = s.kind === "pickup" ? <Store className="h-3.5 w-3.5" /> : <Home className="h-3.5 w-3.5" />;
  const tone = s.kind === "pickup" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";
  if (s.done) {
    return (
      <div className="flex items-center gap-2 px-1 py-1.5 opacity-60">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
        <span className="flex-1 truncate text-sm line-through">
          <span className="font-medium">{s.kind === "pickup" ? "Pickup" : "Drop-off"}</span> · {s.who}
        </span>
        <span className="text-xs tabular-nums text-stone-500">{s.time}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-1 py-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-stone-700 ring-1 ring-stone-300">{idx + 1}</span>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${tone}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{s.kind === "pickup" ? "Pickup" : "Drop-off"} · {s.who}</div>
        <div className="truncate text-xs text-stone-500">{s.where}</div>
      </div>
      <span className="text-xs tabular-nums text-stone-500">{s.time}</span>
    </div>
  );
}

export function RiderTripStops() {
  const next = stops.find((s) => s.isNext)!;
  const completed = stops.filter((s) => s.done);
  const upcoming = stops.filter((s) => !s.done && !s.isNext);

  return (
    <div className="min-h-screen bg-[#f6f3ec] font-sans text-[#0e2746]">
      <div className="mx-auto max-w-[420px] px-4 pb-8 pt-4">
        {/* Top bar */}
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-stone-500">Trip #42</div>
            <div className="text-base font-bold">4 orders · 8 stops</div>
          </div>
          <button className="rounded-full p-2 text-stone-600 hover:bg-stone-100">
            <MoreVertical className="h-5 w-5" />
          </button>
        </div>

        {/* Completed (collapsed) */}
        <details className="mb-3 rounded-lg border border-stone-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
            <Check className="h-4 w-4 text-emerald-600" />
            <span className="font-medium">{completed.length} stops done</span>
            <ChevronRight className="ml-auto h-4 w-4 text-stone-400" />
          </summary>
          <div className="border-t border-stone-100 px-2 py-1">
            {completed.map((s, i) => <MiniStop key={`done-${i}`} s={s} idx={i} />)}
          </div>
        </details>

        {/* Next stop — hero card */}
        <div className="mb-3 overflow-hidden rounded-2xl bg-[#0e2746] text-white shadow-lg">
          <div className="flex items-center justify-between px-4 pt-3 text-[11px] uppercase tracking-wider opacity-80">
            <span>Next stop · {completed.length + 1} of {stops.length}</span>
            <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-amber-300">{next.kind}</span>
          </div>
          <div className="px-4 pb-3 pt-2">
            <div className="flex items-center gap-2 text-xl font-bold">
              <Store className="h-5 w-5" /> {next.who}
            </div>
            <div className="mt-0.5 text-sm opacity-80">Order #{next.orderId} · {next.where}</div>
            <div className="mt-3 flex items-center gap-3 text-sm">
              <span className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1">
                <Clock className="h-3.5 w-3.5" /> {next.time}
              </span>
              <span className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1">
                <MapPin className="h-3.5 w-3.5" /> 0.6 km
              </span>
              <button className="ml-auto rounded-md bg-white/10 p-2 hover:bg-white/20"><Phone className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-px bg-white/10">
            <button className="bg-emerald-500 py-3 text-sm font-bold hover:bg-emerald-600">Picked up</button>
            <button className="bg-amber-500 py-3 text-sm font-semibold text-[#0e2746] hover:bg-amber-400">Postpone</button>
            <button className="bg-white/5 py-3 text-sm hover:bg-white/10">Skip</button>
          </div>
        </div>

        {/* Upcoming */}
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="border-b border-stone-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            Upcoming · {upcoming.length}
          </div>
          <div className="px-2 py-1">
            {upcoming.map((s, i) => <MiniStop key={`up-${i}`} s={s} idx={completed.length + 1 + i} />)}
          </div>
        </div>

        {/* Out-of-order soft warning sample */}
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>If you tap "Picked up" on a stop further down the list, we'll ask you to confirm — we won't block it.</span>
        </div>

        <button className="mt-3 w-full rounded-md border border-stone-300 bg-white py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">
          Unbundle remaining stops
        </button>
      </div>
    </div>
  );
}
