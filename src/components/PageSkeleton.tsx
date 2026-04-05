/**
 * Skeleton loading components for page transitions.
 * Used in PlannerPage and CharterPage via React.lazy + Suspense.
 */

function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-xl bg-gray-200/60 ${className}`} />
  );
}

export function PageSkeleton() {
  return (
    <div className="min-h-screen bg-[#faf9f6]">
      {/* Header skeleton */}
      <div className="h-20 bg-white/80 border-b border-gray-100 flex items-center px-6">
        <SkeletonBlock className="w-32 h-8" />
        <div className="flex-1" />
        <div className="flex gap-4">
          <SkeletonBlock className="w-20 h-8" />
          <SkeletonBlock className="w-20 h-8" />
          <SkeletonBlock className="w-20 h-8" />
        </div>
      </div>

      {/* Hero skeleton */}
      <SkeletonBlock className="w-full h-[40vh] rounded-none" />

      {/* Content skeleton */}
      <div className="max-w-5xl mx-auto px-6 py-12 space-y-8">
        <SkeletonBlock className="w-2/3 h-10" />
        <SkeletonBlock className="w-full h-5" />
        <SkeletonBlock className="w-4/5 h-5" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-4 p-6 bg-white rounded-2xl shadow-sm">
              <SkeletonBlock className="w-full h-32" />
              <SkeletonBlock className="w-3/4 h-5" />
              <SkeletonBlock className="w-1/2 h-4" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-6 mt-8">
          <SkeletonBlock className="h-48" />
          <SkeletonBlock className="h-48" />
        </div>
      </div>
    </div>
  );
}

export function CharterSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: '#080b14' }}>
      {/* Header */}
      <div className="h-20 flex items-center px-6 border-b border-white/5">
        <SkeletonBlock className="w-32 h-8 !bg-white/10" />
        <div className="flex-1" />
        <SkeletonBlock className="w-24 h-8 !bg-white/10" />
      </div>

      {/* Hero */}
      <div className="max-w-5xl mx-auto px-6 py-16 space-y-6">
        <SkeletonBlock className="w-48 h-7 !bg-white/10" />
        <SkeletonBlock className="w-2/3 h-12 !bg-white/10" />
        <SkeletonBlock className="w-full h-5 !bg-white/10" />
      </div>

      {/* Vehicle cards */}
      <div className="max-w-5xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl p-6 border border-white/10 space-y-4">
            <SkeletonBlock className="w-full h-24 !bg-white/10" />
            <SkeletonBlock className="w-1/2 h-6 !bg-white/10" />
            <SkeletonBlock className="w-1/3 h-5 !bg-white/10" />
          </div>
        ))}
      </div>

      {/* Form skeleton */}
      <div className="max-w-5xl mx-auto px-6 py-12 space-y-6">
        <SkeletonBlock className="w-full h-14 !bg-white/10" />
        <SkeletonBlock className="w-full h-14 !bg-white/10" />
        <div className="grid grid-cols-2 gap-6">
          <SkeletonBlock className="h-14 !bg-white/10" />
          <SkeletonBlock className="h-14 !bg-white/10" />
        </div>
        <SkeletonBlock className="w-full h-12 !bg-white/10" />
      </div>
    </div>
  );
}

export function PlannerSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: '#080b14' }}>
      {/* Header */}
      <div className="h-20 flex items-center px-6 border-b border-white/5">
        <SkeletonBlock className="w-32 h-8 !bg-white/10" />
        <div className="flex-1" />
        <SkeletonBlock className="w-24 h-8 !bg-white/10" />
      </div>

      {/* Hero */}
      <div className="max-w-3xl mx-auto px-6 py-20 text-center space-y-6">
        <SkeletonBlock className="w-32 h-7 mx-auto !bg-white/10" />
        <SkeletonBlock className="w-2/3 h-14 mx-auto !bg-white/10" />
        <SkeletonBlock className="w-full h-5 mx-auto !bg-white/10" />
      </div>

      {/* Wizard form skeleton */}
      <div className="max-w-3xl mx-auto px-6 space-y-6 pb-20">
        <SkeletonBlock className="w-full h-10 !bg-white/10" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonBlock key={i} className="h-20 !bg-white/10" />
          ))}
        </div>
        <SkeletonBlock className="w-full h-14 !bg-white/10" />
      </div>
    </div>
  );
}
