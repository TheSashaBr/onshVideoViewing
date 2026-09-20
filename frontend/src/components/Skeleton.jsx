import React from 'react';
import { cn } from '../utils/cn';
import { Film } from 'lucide-react';

export function Skeleton({ className = '', ...props }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden bg-white/[0.05] rounded-xl before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/[0.08] before:to-transparent',
        className
      )}
      {...props}
    />
  );
}

export function ChatMessageSkeleton({ isSelf = false }) {
  return (
    <div className={cn('flex items-end gap-2.5 w-full my-2.5', isSelf ? 'justify-end' : 'justify-start')}>
      {!isSelf && <Skeleton className="w-8 h-8 rounded-full shrink-0" />}
      <div className={cn('flex flex-col gap-1.5 max-w-[70%]', isSelf ? 'items-end' : 'items-start')}>
        {!isSelf && <Skeleton className="h-3 w-20 rounded-md" />}
        <Skeleton className={cn('h-10 rounded-2xl', isSelf ? 'w-48 bg-accent/15' : 'w-56')} />
      </div>
      {isSelf && <Skeleton className="w-8 h-8 rounded-full shrink-0 bg-accent/20" />}
    </div>
  );
}

export function MemberCardSkeleton() {
  return (
    <li role="presentation" className="flex items-center justify-between p-3 rounded-2xl border border-border-subtle bg-surface-raised/40">
      <div className="flex items-center gap-3 flex-1">
        <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
        <div className="flex flex-col gap-1.5 flex-1">
          <Skeleton className="h-3.5 w-28 rounded-md" />
          <Skeleton className="h-2.5 w-16 rounded-md" />
        </div>
      </div>
      <Skeleton className="w-6 h-6 rounded-lg shrink-0" />
    </li>
  );
}

export function PlayerSkeleton() {
  return (
    <div className="relative w-full h-full min-h-[240px] bg-black flex flex-col items-center justify-center overflow-hidden">
      <Skeleton className="absolute inset-0 rounded-none bg-white/[0.02]" />
      <div className="relative z-10 flex flex-col items-center gap-3 text-gray-500">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-border-subtle flex items-center justify-center shadow-glass">
          <Film className="w-7 h-7 text-gray-400 animate-pulse-subtle" />
        </div>
        <Skeleton className="h-3.5 w-32 rounded-md" />
      </div>
    </div>
  );
}

export default Skeleton;
