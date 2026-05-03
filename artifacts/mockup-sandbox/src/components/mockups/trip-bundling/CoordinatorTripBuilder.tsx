import { useState } from "react";
import { GripVertical, Plus, Bike, Store, Home, X, Check } from "lucide-react";

type Order = {
  id: string;
  customer: string;
  area: string;
  restaurant: string;
  pickupTime: string;
  items: number;
  selected: boolean;
};

type Stop = {
  kind: "pickup" | "dropoff";
  orderId: string;
  label: string;
  sublabel: string;
  time: string;
};

const initialOrders: Order[] = [
  { id: "1001", customer: "De Vries — Westerstr. 12", area: "Centrum", restaurant: "Pizza Roma", pickupTime: "18:00", items: 2, selected: true },
  { id: "1002", customer: "Jansen — Marnixkade 8", area: "Centrum", restaurant: "Pizza Roma", pickupTime: "18:15", items: 3, selected: true },
  { id: "1003", customer: "Bakker — Reguliersgr. 44", area: "Centrum", restaurant: "Sushi Haru", pickupTime: "18:10", items: 1, selected: true },
  { id: "1004", customer: "Smit — Prinsengr. 290", area: "Centrum", restaurant: "Wok Express", pickupTime: "18:25", items: 4, selected: true },
  { id: "1005", customer: "Visser — Oost", area: "Oost", restaurant: "Pizza Roma", pickupTime: "18:30", items: 1, selected: false },
  { id: "1006", customer: "Kuiper — Zuid", area: "Zuid", restaurant: "Sushi Haru", pickupTime: "18:20", items: 2, selected: false },
];

const initialStops: Stop[] = [
  { kind: "pickup", orderId: "1001", label: "Pickup at Pizza Roma", sublabel: "Order #1001 · De Vries", time: "18:00" },
  { kind: "pickup", orderId: "1002", label: "Pickup at Pizza Roma", sublabel: "Order #1002 · Jansen — bundled, same restaurant", time: "18:00" },
  { kind: "pickup", orderId: "1003", label: "Pickup at Sushi Haru", sublabel: "Order #1003 · Bakker", time: "18:10" },
  { kind: "dropoff", orderId: "1002", label: "Drop-off Jansen", sublabel: "Marnixkade 8 · Centrum", time: "≈ 18:20" },
  { kind: "dropoff", orderId: "1003", label: "Drop-off Bakker", sublabel: "Reguliersgr. 44 · Centrum", time: "≈ 18:25" },
  { kind: "pickup", orderId: "1004", label: "Pickup at Wok Express", sublabel: "Order #1004 · Smit", time: "18:25" },
  { kind: "dropoff", orderId: "1004", label: "Drop-off Smit", sublabel: "Prinsengr. 290 · Centrum", time: "≈ 18:35" },
  { kind: "dropoff", orderId: "1001", label: "Drop-off De Vries", sublabel: "Westerstr. 12 · Centrum", time: "≈ 18:45" },
];

export function CoordinatorTripBuilder() {
  const [orders] = useState(initialOrders);
  const [stops] = useState(initialStops);
  const selected = orders.filter((o) => o.selected);

  return (
    <div className="min-h-screen bg-[#f6f3ec] p-6 font-sans text-[#0e2746]">
      <div className="mx-auto max-w-[1040px]">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-stone-500">Coordinator · Dispatch</div>
            <h1 className="mt-0.5 text-2xl font-bold">New trip</h1>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">Cancel</button>
            <button className="rounded-md bg-[#0e2746] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0a1e36]">
              Save trip · {selected.length} orders
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5">
          {/* Available orders */}
          <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Available orders</h2>
              <span className="text-xs text-stone-500">{selected.length} of {orders.length} selected</span>
            </div>
            <input
              placeholder="Filter by area, restaurant, customer..."
              className="mb-3 w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm placeholder:text-stone-400 focus:border-[#0e2746] focus:outline-none"
            />
            <ul className="space-y-2">
              {orders.map((o) => (
                <li
                  key={o.id}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2.5 ${
                    o.selected ? "border-[#0e2746]/40 bg-[#0e2746]/[0.04]" : "border-stone-200 bg-white"
                  }`}
                >
                  <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${o.selected ? "border-[#0e2746] bg-[#0e2746] text-white" : "border-stone-300 bg-white"}`}>
                    {o.selected && <Check className="h-3 w-3" strokeWidth={3} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold">#{o.id}</span>
                      <span className="text-stone-500">·</span>
                      <span className="truncate text-stone-700">{o.customer}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-stone-500">
                      <Store className="h-3 w-3" />
                      <span>{o.restaurant}</span>
                      <span>·</span>
                      <span>{o.items} items</span>
                      <span>·</span>
                      <span>pickup {o.pickupTime}</span>
                    </div>
                  </div>
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-stone-600">{o.area}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Stop sequence */}
          <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Stop sequence</h2>
              <span className="text-xs text-stone-500">{stops.length} stops · drag to reorder</span>
            </div>

            <ol className="space-y-1.5">
              {stops.map((s, i) => {
                const isPickup = s.kind === "pickup";
                return (
                  <li key={`${s.kind}-${s.orderId}-${i}`} className="group flex items-center gap-2 rounded-md border border-stone-200 bg-white px-2 py-2 hover:border-stone-300">
                    <GripVertical className="h-4 w-4 shrink-0 text-stone-400" />
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0e2746] text-[11px] font-bold text-white">{i + 1}</span>
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${
                        isPickup ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                      }`}
                      title={isPickup ? "Pickup" : "Drop-off"}
                    >
                      {isPickup ? <Store className="h-3.5 w-3.5" /> : <Home className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{s.label}</div>
                      <div className="truncate text-xs text-stone-500">{s.sublabel}</div>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-stone-500">{s.time}</span>
                    <button className="opacity-0 transition group-hover:opacity-100">
                      <X className="h-3.5 w-3.5 text-stone-400 hover:text-stone-700" />
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="mt-3 flex items-center justify-between rounded-md border border-dashed border-stone-300 px-3 py-2 text-xs text-stone-500">
              <span className="flex items-center gap-1.5"><Plus className="h-3 w-3" /> Drag an order from the left to add stops</span>
            </div>

            <div className="mt-4 rounded-md bg-stone-50 p-3 text-xs">
              <label className="mb-2 flex items-center gap-2">
                <input type="radio" defaultChecked className="accent-[#0e2746]" />
                <span className="font-medium">Open — anyone can claim</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" className="accent-[#0e2746]" />
                <span className="font-medium">Assign to:</span>
                <select className="ml-1 rounded border border-stone-300 bg-white px-2 py-0.5 text-xs">
                  <option>Pieter (on shift)</option>
                  <option>Anna (on shift)</option>
                </select>
              </label>
              <div className="mt-2 flex items-center gap-1.5 text-stone-500">
                <Bike className="h-3 w-3" /> Same-restaurant pickups in this trip auto-share the earliest pickup time (18:00).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
