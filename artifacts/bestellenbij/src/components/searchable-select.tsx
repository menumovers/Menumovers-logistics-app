import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type SearchableSelectOption = { value: string; label: string };

/**
 * A Select look-alike with a search box, for lists long enough that
 * scrolling to find one entry stops being practical (e.g. every restaurant
 * or rider in the system). The first entry in `options` is expected to be
 * the "all" sentinel — this component doesn't special-case it.
 */
export function SearchableSelect({
  value,
  onValueChange,
  options,
  searchPlaceholder,
  emptyText,
  triggerTestId,
  itemTestId,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  searchPlaceholder: string;
  emptyText: string;
  triggerTestId?: string;
  itemTestId?: (value: string) => string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
          data-testid={triggerTestId}
        >
          <span className="truncate">{selected?.label ?? ""}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => {
                    onValueChange(o.value);
                    setOpen(false);
                  }}
                  data-testid={itemTestId?.(o.value)}
                >
                  <Check className={cn("mr-2 size-4", value === o.value ? "opacity-100" : "opacity-0")} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
