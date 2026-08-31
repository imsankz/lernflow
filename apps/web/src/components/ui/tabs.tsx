import * as React from "react";

import { cn } from "@/lib/utils";

const Tabs = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { value?: string; defaultValue?: string; onValueChange?: (v: string) => void }>(
  ({ className, value, defaultValue, onValueChange, ...props }, ref) => {
    const [internal, setInternal] = React.useState(defaultValue ?? "");
    const active = value ?? internal;
    return (
      <TabsContext.Provider value={{ active, setActive: (v) => { setInternal(v); onValueChange?.(v); } }}>
        <div ref={ref} className={cn("flex flex-col gap-2", className)} {...props} />
      </TabsContext.Provider>
    );
  },
);
Tabs.displayName = "Tabs";

const TabsContext = React.createContext<{ active: string; setActive: (v: string) => void }>({
  active: "",
  setActive: () => {},
});

const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground", className)}
      {...props}
    />
  ),
);
TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }>(
  ({ className, value, ...props }, ref) => {
    const { active, setActive } = React.useContext(TabsContext);
    const isActive = active === value;
    return (
      <button
        ref={ref}
        onClick={() => setActive(value)}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
          isActive ? "bg-background text-foreground shadow" : "hover:text-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { value: string }>(
  ({ className, value, ...props }, ref) => {
    const { active } = React.useContext(TabsContext);
    if (active !== value) return null;
    return <div ref={ref} className={cn("mt-2 focus-visible:outline-none", className)} {...props} />;
  },
);
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
