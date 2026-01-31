'use client'

import * as React from 'react'
import * as Vaul from 'vaul'
import { cn } from '@/lib/utils'

const Drawer = Vaul.Drawer.Root

const DrawerTrigger = Vaul.Drawer.Trigger

const DrawerClose = Vaul.Drawer.Close

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof Vaul.Drawer.Content>,
  React.ComponentPropsWithoutRef<typeof Vaul.Drawer.Content>
>(({ className, children, ...props }, ref) => (
  <Vaul.Drawer.Portal>
    <Vaul.Drawer.Overlay className="fixed inset-0 z-50 bg-black/80" />
    <Vaul.Drawer.Content
      ref={ref}
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50 mt-24 flex h-[calc(100vh-6rem)] flex-col rounded-t-[10px] border-t border-border bg-background',
        className
      )}
      {...props}
    >
      <div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />
      {children}
    </Vaul.Drawer.Content>
  </Vaul.Drawer.Portal>
))
DrawerContent.displayName = 'DrawerContent'

export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
}

