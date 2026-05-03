import { Layers, Clock, Info, Store, Bike } from "lucide-react";

type LineItem = { qty: number; name: string };

function OrderCard({
  id, customer, items, originalTime, bundled,
}: { id: string; customer: string; items: LineItem[]; originalTime: string; bundled?: boolean }) {
  return (
    <div className="rounded-lg bg-white p-4 ring-1 ring-stone-200">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-bold">#{id}</span>
          <span className="text-stone-500">·</span>
          <span>{customer}</span>
        </div>
        {bundled && originalTime && (
          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 line-through">
            was {originalTime}
          </span>
        )}
      </div>
      <ul className="space-y-1 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-2 text-stone-700">
            <span className="w-7 shrink-0 text-right text-stone-500 tabular-nums">{it.qty}×</span>
            <span>{it.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RestaurantBundled() {
  return (
    <div className="min-h-screen bg-[#f6f3ec] p-6 font-sans text-[#0e2746]">
      <div className="mx-auto max-w-[840px]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-stone-500">Pizza Roma · Restaurant view</div>
            <h1 className="mt-0.5 text-xl font-bold">Today's pickups</h1>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-stone-600 ring-1 ring-stone-200">3 active</span>
        </div>

        {/* Bundled card */}
        <div className="mb-4 overflow-hidden rounded-xl bg-[#0e2746]/[0.04] p-4 ring-2 ring-[#0e2746]/40">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0e2746] text-white">
                <Layers className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-bold">Bundled pickup · 2 orders</div>
                <div className="text-xs text-stone-600">One rider will pick these up together.</div>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-white px-3 py-1.5 ring-1 ring-stone-200">
              <Clock className="h-4 w-4 text-[#0e2746]" />
              <span className="text-sm font-bold tabular-nums">18:00</span>
            </div>
          </div>

          <div className="mb-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Both orders share the earliest pickup time in the bundle.
              <strong className="font-semibold"> Order #1002 was originally 18:15 — please have it ready by 18:00.</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <OrderCard
              id="1001"
              customer="De Vries"
              originalTime="18:00"
              bundled
              items={[
                { qty: 1, name: "Margherita 30cm" },
                { qty: 1, name: "Tiramisu" },
              ]}
            />
            <OrderCard
              id="1002"
              customer="Jansen"
              originalTime="18:15"
              bundled
              items={[
                { qty: 1, name: "Quattro Formaggi 30cm" },
                { qty: 1, name: "Caprese salad" },
                { qty: 1, name: "Bottle still water" },
              ]}
            />
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-stone-600">
            <span className="flex items-center gap-1.5"><Bike className="h-3 w-3" /> Trip #42 · rider Pieter</span>
            <button className="rounded-md bg-[#0e2746] px-3 py-1.5 text-xs font-semibold text-white">Mark both ready</button>
          </div>
        </div>

        {/* Solo order — for contrast */}
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-stone-100 text-stone-600">
                <Store className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-bold">Solo pickup</div>
                <div className="text-xs text-stone-500">Standalone — separate rider.</div>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-stone-50 px-3 py-1.5 ring-1 ring-stone-200">
              <Clock className="h-4 w-4 text-stone-500" />
              <span className="text-sm font-bold tabular-nums">18:40</span>
            </div>
          </div>
          <OrderCard
            id="1011"
            customer="Hendriks"
            originalTime=""
            items={[
              { qty: 1, name: "Diavola 30cm" },
              { qty: 2, name: "Coca-Cola" },
            ]}
          />
          <div className="mt-3 flex items-center justify-end">
            <button className="rounded-md bg-[#0e2746] px-3 py-1.5 text-xs font-semibold text-white">Mark ready</button>
          </div>
        </div>
      </div>
    </div>
  );
}
